#!/usr/bin/env bash
# Final-5 — DR end-to-end: backup → destroy → restore → validate → smoke.
# Requer: pg_dump, pg_restore, psql, node/pnpm (app), curl.
# Uso em CI: ver .github/workflows/dr-e2e.yml
# Uso local: DR_POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/postgres ./infra/scripts/dr-e2e.sh
set -euo pipefail

: "${DR_POSTGRES_URL:?DR_POSTGRES_URL é obrigatório (superuser com CREATE DATABASE)}"

START_TS=$(date +%s)
FIXTURE_TAG="dr-fixture-$(date -u +%Y%m%dT%H%M%SZ)"
SRC_DB="connect_desk_dr_src"
DST_DB="connect_desk_dr_dst"
BACKUP_DIR="${DR_BACKUP_DIR:-/tmp/dr-e2e}"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/$FIXTURE_TAG.dump"

log() { echo "[dr-e2e] $*"; }
fail() { echo "[dr-e2e] FATAL: $*" >&2; exit 1; }

for bin in pg_dump pg_restore psql; do
  command -v "$bin" >/dev/null 2>&1 || fail "binário ausente: $bin"
done

admin_psql() { psql "$DR_POSTGRES_URL" -v ON_ERROR_STOP=1 -tAX -c "$1"; }
db_url() { echo "$DR_POSTGRES_URL" | sed -E "s|/[^/?]+(\\?\|$)|/$1\\1|"; }

# 1-2. Banco limpo + migrations
log "1/13 criando banco limpo $SRC_DB"
admin_psql "DROP DATABASE IF EXISTS \"$SRC_DB\";" >/dev/null
admin_psql "CREATE DATABASE \"$SRC_DB\";" >/dev/null
log "2/13 aplicando migrations"
DATABASE_URL="$(db_url "$SRC_DB")" pnpm --filter @cvg/database db:migrate >/dev/null

# 3. Fixture representativa
log "3/13 inserindo fixture $FIXTURE_TAG"
FIXTURE_JSON=$(DATABASE_URL="$(db_url "$SRC_DB")" DR_FIXTURE_TAG="$FIXTURE_TAG" node --input-type=module <<'NODEEOF'
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const c = await pool.connect();
const tag = process.env.DR_FIXTURE_TAG;
const uid = (await c.query("INSERT INTO users(name,email,password_hash) VALUES('DR Fixture','" + tag + "@example.com','x') RETURNING id")).rows[0].id;
const cid = (await c.query("INSERT INTO contacts(phone,name) VALUES('+5500000000000','" + tag + "') RETURNING id")).rows[0].id;
const conv = (await c.query("INSERT INTO conversations(contact_id,status) VALUES('" + cid + "','open') RETURNING id")).rows[0].id;
const msg = (await c.query("INSERT INTO messages(conversation_id,direction,content,external_message_id) VALUES('" + conv + "','inbound','" + tag + "','" + tag + "-msg') RETURNING id")).rows[0].id;
await c.query("INSERT INTO outbox_events(event_id,event_type,aggregate_type,aggregate_id,occurred_at,payload,version) VALUES('" + tag + "-evt','message.persisted','Message','" + msg + "',NOW(),'{}',1)");
await c.query("INSERT INTO audit_logs(action,entity_type,entity_id) VALUES('dr.fixture','fixture','" + conv + "')");
await c.query("INSERT INTO dead_letter_events(original_event_id,consumer_id,event_type,payload) VALUES('" + tag + "-dlq','worker','message.persisted','{}')");
console.log(JSON.stringify({ userId: uid, contactId: cid, conversationId: conv, messageId: msg }));
c.release(); await pool.end();
NODEEOF
)
echo "$FIXTURE_JSON" > "$BACKUP_DIR/$FIXTURE_TAG.fixture.json"
log "fixture: $FIXTURE_JSON"

# 4-5. Backup + checksum
log "4/13 backup"
pg_dump --format=custom --compress=9 --file="$BACKUP_FILE" "$(db_url "$SRC_DB")"
sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256"
log "5/13 checksum: $(cut -d' ' -f1 "$BACKUP_FILE.sha256")"

# 6-8. Destruir, recriar, restaurar
log "6/13 destruindo banco origem"
admin_psql "DROP DATABASE \"$SRC_DB\";" >/dev/null
log "7/13 criando banco destino $DST_DB"
admin_psql "DROP DATABASE IF EXISTS \"$DST_DB\";" >/dev/null
admin_psql "CREATE DATABASE \"$DST_DB\";" >/dev/null
log "8/13 restore"
sha256sum -c "$BACKUP_FILE.sha256"
pg_restore --clean --if-exists --no-owner --dbname="$(db_url "$DST_DB")" "$BACKUP_FILE"

# 9-10. Estrutura + integrity queries
log "9/13 validando estrutura"
for table in users sessions contacts conversations messages outbox_events outbox_consumer_acks dead_letter_events audit_logs media_assets; do
  exists=$(psql "$(db_url "$DST_DB")" -tAX -c "SELECT to_regclass('public.$table');")
  [ "$exists" = "$table" ] || fail "tabela ausente após restore: $table"
done
log "10/13 integrity queries"
for query in \
  "SELECT count(*) FROM users" \
  "SELECT count(*) FROM conversations" \
  "SELECT count(*) FROM messages" \
  "SELECT count(*) FROM outbox_events" \
  "SELECT count(*) FROM dead_letter_events" \
  "SELECT count(*) FROM audit_logs"; do
  count=$(psql "$(db_url "$DST_DB")" -tAX -c "$query")
  log "  $query => $count"
done

# 11-13. Boot da aplicação + smoke + comparação da fixture
log "11/13 boot da aplicação contra banco restaurado"
DATABASE_URL="$(db_url "$DST_DB")" PORT=4339 NODE_ENV=development LOG_LEVEL=warn timeout 60 pnpm --filter @cvg/desk-api exec tsx src/index.ts >/tmp/dr-e2e-app.log 2>&1 &
APP_PID=$!
trap 'kill $APP_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  if curl -sf -o /dev/null http://localhost:4339/health; then break; fi
  sleep 2
done
curl -sf http://localhost:4339/health >/dev/null || fail "aplicação não subiu contra banco restaurado"
log "12/13 smoke: readiness"
curl -sf http://localhost:4339/readiness | grep -q '"ready":true' || fail "readiness não pronto"
log "13/13 comparando fixture restaurada"
RESTORED=$(DATABASE_URL="$(db_url "$DST_DB")" DR_FIXTURE_TAG="$FIXTURE_TAG" node --input-type=module <<'NODEEOF'
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const c = await pool.connect();
const tag = process.env.DR_FIXTURE_TAG;
const msg = await c.query("SELECT content FROM messages WHERE external_message_id='" + tag + "-msg'");
const evt = await c.query("SELECT event_id FROM outbox_events WHERE event_id='" + tag + "-evt'");
const dlq = await c.query("SELECT original_event_id FROM dead_letter_events WHERE original_event_id='" + tag + "-dlq'");
console.log(JSON.stringify({ message: msg.rows[0]?.content || null, event: evt.rows[0]?.event_id || null, dlq: dlq.rows[0]?.original_event_id || null }));
c.release(); await pool.end();
NODEEOF
)
echo "$RESTORED" | grep -q "$FIXTURE_TAG" || fail "fixture divergente após restore: $RESTORED"

kill $APP_PID 2>/dev/null || true
trap - EXIT

DURATION=$(( $(date +%s) - START_TS ))
log "OK: DR E2E completo em ${DURATION}s (RPO/RTO ver docs/DISASTER_RECOVERY.md)"

# Limpeza
admin_psql "DROP DATABASE IF EXISTS \"$DST_DB\";" >/dev/null
rm -f "$BACKUP_FILE" "$BACKUP_FILE.sha256" "$BACKUP_DIR/$FIXTURE_TAG.fixture.json"
log "limpeza concluída"
