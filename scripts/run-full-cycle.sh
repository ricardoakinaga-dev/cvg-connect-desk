#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.dev.yml}"
TARGET_URL="${TARGET_URL:-http://localhost:3000}"
RATE_LIMIT_MAX="${RATE_LIMIT_MAX:-50000}"
RATE_LIMIT_WINDOW="${RATE_LIMIT_WINDOW:-1m}"
AUTH_CACHE_TTL_MS="${AUTH_CACHE_TTL_MS:-60000}"
HEALTH_CACHE_TTL_MS="${HEALTH_CACHE_TTL_MS:-10000}"
DASHBOARD_SUMMARY_CACHE_TTL_MS="${DASHBOARD_SUMMARY_CACHE_TTL_MS:-10000}"
GET_RESPONSE_CACHE_TTL_MS="${GET_RESPONSE_CACHE_TTL_MS:-10000}"
SUMMARY_PATH="${SUMMARY_PATH:-$ROOT_DIR/stress-test/summary.json}"
QA_PERF_PROFILE="${QA_PERF_PROFILE:-production}"
if [ -z "${P95_THRESHOLD_MS:-}" ]; then
  if [ "$QA_PERF_PROFILE" = "local-docker" ]; then
    P95_THRESHOLD_MS=1500
  else
    P95_THRESHOLD_MS=500
  fi
fi
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
TEARDOWN="${TEARDOWN:-0}"
STARTED_DESK_API=0

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  log "ERRO: $*"
  exit 1
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fail "Comando ausente: $cmd"
}

health_status_code() {
  local url="$1"
  local output_file="$2"
  curl -sS -o "$output_file" -w '%{http_code}' "$url" || true
}

health_payload_ok() {
  local output_file="$1"
  node - "$output_file" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
try {
  const payload = JSON.parse(fs.readFileSync(path, 'utf8'));
  process.exit(payload && payload.status === 'ok' ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

validate_prerequisites() {
  log "Pré-check do ciclo: docker + compose + pnpm + curl"
  require_cmd docker
  require_cmd pnpm
  require_cmd curl

  if ! docker compose version >/dev/null 2>&1; then
    fail "docker compose indisponível. Instale/atualize Docker com Compose plugin."
  fi

  if [ ! -f "$COMPOSE_FILE" ]; then
    fail "Arquivo do compose não encontrado: $COMPOSE_FILE"
  fi

  mkdir -p "$(dirname "$SUMMARY_PATH")"
}

cleanup() {
  if [ "$TEARDOWN" = "1" ] && [ "$STARTED_DESK_API" = "1" ]; then
    log "TEARDOWN=1 definido: encerrando desk-api"
    docker compose -f "$COMPOSE_FILE" stop desk-api
  fi
}

trap cleanup EXIT

repair_node_modules_ownership() {
  local uid gid
  uid="$(id -u)"
  gid="$(id -g)"
  docker run --rm -v "$ROOT_DIR":/work alpine sh -c "chown -R ${uid}:${gid} /work/node_modules /work/apps /work/modules /work/packages 2>/dev/null || true" >/dev/null
}

restore_host_workspace_dependencies() {
  log "Restaurando links de dependências locais após install do container"
  repair_node_modules_ownership
  pnpm install --frozen-lockfile --ignore-scripts
}

wait_for_health() {
  local timeout="$1"
  local elapsed=0
  local health_url="${TARGET_URL%/}/health"
  local health_file

  log "Aguardando health check em ${health_url} (máx ${timeout}s)"
  health_file="$(mktemp)"

  while [ "$elapsed" -lt "$timeout" ]; do
    local status
    status="$(health_status_code "$health_url" "$health_file")"
    if [ "$status" = "200" ] && health_payload_ok "$health_file"; then
      log "Health check ok (status 200, payload status=ok)."
      cat "$health_file"
      rm -f "$health_file"
      return 0
    fi

    log "Health ainda indisponível (status=${status:-000}, payload status != ok), aguardando..."
    sleep 2
    elapsed=$((elapsed + 2))
  done

  log "Timeout aguardando health após ${timeout}s: status final=${status:-000}"
  rm -f "$health_file"
  return 1
}

print_summary() {
  if [ ! -f "$SUMMARY_PATH" ]; then
    log "Arquivo de summary não encontrado: $SUMMARY_PATH"
    return 1
  fi

  log "Resumo de thresholds (stress-test/summary.json):"
  if command -v jq >/dev/null 2>&1; then
    if ! jq -e '(.scenario_thresholds | type == "object") and
              (.summary | type == "object") and
              (.scenario_thresholds.scenario_passed | type == "boolean") and
              (.scenario_thresholds.duration_p95_ms | type == "object") and
              (.scenario_thresholds.error_rate_5xx_percent | type == "object") and
              (.scenario_thresholds.checks_rate | type == "object")' \
              "$SUMMARY_PATH" >/dev/null; then
      log "SUMMARY inválido: campos obrigatórios de schema ausentes."
      return 1
    fi

    jq '{scenario_thresholds: .scenario_thresholds, summary: .summary}' "$SUMMARY_PATH"
    local scenario_passed
    scenario_passed="$(jq -r '.scenario_thresholds.scenario_passed // "false"' "$SUMMARY_PATH")"
    if [ "$scenario_passed" != "true" ]; then
      log "Cenário não passou nos thresholds do summary."
      return 1
    fi
    return 0
  fi

  SUMMARY_PATH="$SUMMARY_PATH" node - <<'NODE'
const fs = require('fs');
const path = process.env.SUMMARY_PATH;
const payload = JSON.parse(fs.readFileSync(path, 'utf8'));
if (!payload || typeof payload !== 'object') {
  console.error('SUMMARY inválido: payload vazio ou não é objeto');
  process.exit(2);
}
const thresholds = payload.scenario_thresholds;
const summary = payload.summary;
if (!thresholds || typeof thresholds !== 'object') {
  console.error('SUMMARY inválido: scenario_thresholds ausente.');
  process.exit(2);
}
if (!summary || typeof summary !== 'object') {
  console.error('SUMMARY inválido: summary ausente.');
  process.exit(2);
}
if (typeof thresholds.scenario_passed !== 'boolean') {
  console.error('SUMMARY inválido: scenario_thresholds.scenario_passed ausente.');
  process.exit(2);
}
if (typeof thresholds.duration_p95_ms !== 'object'
  || typeof thresholds.error_rate_5xx_percent !== 'object'
  || typeof thresholds.checks_rate !== 'object') {
  console.error('SUMMARY inválido: campos de thresholds ausentes.');
  process.exit(2);
}
console.log(JSON.stringify({
  scenario_thresholds: payload.scenario_thresholds || null,
  summary: payload.summary || null,
}, null, 2));
if (!thresholds.scenario_passed) {
  console.error('Cenário não passou nos thresholds do summary.');
  process.exit(1);
}
NODE
}

validate_prerequisites

log "Iniciando ciclo completo de validação em $(date '+%Y-%m-%d %H:%M:%S')"
log "Alvo: $TARGET_URL"
log "Compose: $COMPOSE_FILE"

log "Subindo API em $COMPOSE_FILE (rate-limit temporariamente alto)"
RATE_LIMIT_MAX="$RATE_LIMIT_MAX" \
RATE_LIMIT_WINDOW="$RATE_LIMIT_WINDOW" \
AUTH_CACHE_TTL_MS="$AUTH_CACHE_TTL_MS" \
HEALTH_CACHE_TTL_MS="$HEALTH_CACHE_TTL_MS" \
DASHBOARD_SUMMARY_CACHE_TTL_MS="$DASHBOARD_SUMMARY_CACHE_TTL_MS" \
GET_RESPONSE_CACHE_TTL_MS="$GET_RESPONSE_CACHE_TTL_MS" \
docker compose -f "$COMPOSE_FILE" up -d desk-api
STARTED_DESK_API=1

wait_for_health "$HEALTH_TIMEOUT"
restore_host_workspace_dependencies

log "Executando testes de tasks: pnpm --filter @cvg/tasks test"
pnpm --filter @cvg/tasks test

log "Executando stress: pnpm test:stress (k6 via Docker)"
TARGET_URL="$TARGET_URL" \
SUMMARY_PATH="$SUMMARY_PATH" \
QA_PERF_PROFILE="$QA_PERF_PROFILE" \
P95_THRESHOLD_MS="$P95_THRESHOLD_MS" \
pnpm test:stress

if ! print_summary; then
  fail "Resumo de thresholds falhou. Consulte $SUMMARY_PATH"
fi

log "Ciclo completo finalizado."
