# PROD-12 — Relatório de execução

**Cartão:** PROD-12 — Provar leases, DLQ e fanout entre processos (AC1–AC4)
**Itens auditados:** BE06 · BE07 · BE12 · **Contratos:** C04 (G03) · **Gates:** G03/G10
**Estado do cartão:** IMPLEMENTED (não DONE)
**Candidato:** HEAD `754f9badac46278e77d21de91c58eedb15e80581` + worktree (delta **não commitado**).
Fronteiras respeitadas: `packages/auth`, `packages/media`, `modules/privacy`,
`packages/database/src/schema.ts`, `supabase/migrations/**`, `contact-groups` e
`conversation.repository` **não** foram tocados. Nenhum arquivo de outro
executor foi sobrescrito.

Ambiente de prova (harness AAA, nunca o banco do host): PostgreSQL 16 + Redis
isolados por run (`marker.runId` conferido, bancos `cvg_aaa_prod12*_wNN`),
migrate real, teardown `stopServices+dropDatabase` por runId.

| Run | Worker | PostgreSQL | Banco | Redis | Exit |
|---|---|---:|---|---:|---:|
| `prod12` (suíte AC, 2 rodadas finais) | 40 | 127.0.0.1:60432 | `cvg_aaa_prod12_w40` | 57080 | 0 |
| `prod12-reg-events` (unit + real-db) | 41 | 60532 | `cvg_aaa_prod12_reg_events_w41` | 57090 | 0 |
| `prod12-reg-worker` | 42 | 60632 | `cvg_aaa_prod12_reg_worker_w42` | 57100 | 0 |
| `prod12-reg-realtime` | 43 | 60732 | `cvg_aaa_prod12_reg_realtime_w43` | 57110 | 0 |
| `prod12-reg-dlq-b` (retomada após colisão de porta) | 45 | 60932 | `cvg_aaa_prod12_reg_dlq_b_w45` | 57130 | 0 |

A rodada `prod12-reg-dlq` (worker 44) **não** é falha do código: a porta PG
60832 estava ocupada por processo de outro run (`PG_PORT_BUSY`), registrada em
`logs/runner-prod12-reg-dlq-portbusy.log`; a suíte foi reexecutada limpa em
`prod12-reg-dlq-b` (exit 0).

---

## 1. Delta

Nenhum arquivo de produção foi alterado para "fazer o teste passar"; o delta é a
prova multi-processo + um endurecimento pontual encontrado pela própria prova:

1. **`apps/desk-api/src/__tests__/production/prod-12.test.ts` (novo, 13 testes)** —
   orquestra processos REAIS: 2× `apps/message-worker/src/index.ts`, 1×
   `apps/desk-api/src/index.ts`, 2× `apps/realtime-service/src/index.ts` e
   processos RPC de lease. SHA-256 `6a513998…` (ver seção 6).
2. **`docs/producao-2026-09-13/evidencias/prod-12/lease-child.ts` (novo)** —
   RPC de claim/renew/ack/nack com a porta de produção
   (`ConsumerAwareOutboxReader`/`PostgresOutboxLease`), uma ação por processo,
   com barreira opcional de início (`startAtEpochMs`) para corrida real.
3. **`packages/events/src/outbox-lease.ts` — fence durável de DLQ no claim.**
   A prova AC2a expôs que o teto de retry era apenas local do processo: um
   worker reiniciado com `WORKER_MAX_RETRIES` maior reclamava um evento já
   dead-letterado e elevava `retry_count` (2→3), embora a DLQ continuasse única.
   Correção adicionada ao predicado do `claim` (sem schema, sem migration):

   ```sql
   AND NOT EXISTS (
     SELECT 1 FROM dead_letter_events dl
     WHERE dl.original_event_id = e.event_id
       AND dl.consumer_id = ${consumerId}
   )
   ```

   Um evento com entrada em `dead_letter_events` para o consumidor passa a ser
   inelegível para **qualquer** processo, com qualquer orçamento local; o
   replay administrativo cria um novo `event_id` e segue normal.

---

## 2. AC1 — leases owner+generation entre processos

**AC1a — dois workers reais no mesmo outbox.** Dois processos
`message-worker` sobem antes do lote; 10 eventos `handoff.completed` são
semeados; cada evento é processado por **exatamente um** dos processos
(`[Worker] Processing event` por `event_id` em um único stdout), com 1 recibo
durável (`worker_effect_receipts`) e 1 alerta por evento, `generation = 1`,
`processed_at` preenchido.

**AC1b — claim concorrente de 4 processos.** 16 eventos, 4 processos
`lease-child` disparando claim no mesmo instante. A partição é
disjunta em todas as rodadas e nenhum evento volta para dois processos; com
`limit=5` foram necessárias 4 rodadas com vencedores alternados
(`[0,0,0,5] → [0,5,0,0] → [0,0,5,0] → [0,0,1,0]`), todas `generation = 1`,
16 linhas de ack (nenhuma extra).

**AC1c — renew mantém + takeover + ACK antigo stale.** Processo A reivindica
com lease de 2 s e renova para 30 s; outro processo B não recebe o evento.
Renew com owner intruso retorna `null`. Após expirar o lease, B toma com
`generation = 2`; o ACK do token antigo (`owner`/`generation` de A) retorna
`stale` e **não** marca `processed_at` nem mexe no retry; B conclui com
`acked`.

**AC1d — crash real após o efeito.** Worker com
`WORKER_FAULT_AFTER_EFFECT=crash` aplica o efeito (1 recibo/1 alerta) e morre
com exit 86 antes do ACK. O lease expira, um segundo processo reivindica com
`generation = 2`, o handler encontra o recibo (`effect_status=deduplicated`) e
ACKa. Total: 1 recibo, 1 alerta, sem duplicata.

Evidência: `logs/runner-prod12.log` (13/13), `prod-12-evidence.json` casos
`AC1a…AC1d`, `logs/ac1a-*-w*.log`, `logs/lease-child-ac1b-*.log`,
`logs/lease-child-ac1c-*.log`, `logs/ac1d-*.log`.

---

## 3. AC2 — DLQ durável e administração por HTTP real

**AC2a — durabilidade + fence + replay.** Evento com falha transitória
injetada por trigger de teste esgota o orçamento (`RETRY_BUDGET_EXHAUSTED`,
`attempt_count=2`), **sem ACK** (`processed_at NULL`, `retry_count=2`). A DLQ
sobrevive à morte do processo: um worker novo com orçamento **divergente**
(`WORKER_MAX_RETRIES=5`) não reclama o evento (fence durável), a linha da DLQ
permanece única e o envelope é idêntico ao do outbox (payload/correlation/
version comparados). `POST /dead-letter/:id/replay` no **desk-api real**
retorna 200, grava `audit_logs` (`dlq.replay`), marca `RESOLVED/replayCount=1`
e reenfileira `…-replay-1` com `causation_id` do original; um worker real o
executa **uma única vez** (1 recibo/1 alerta), enquanto o original segue com 0
recibos.

**AC2b — claim concorrente único.** Dois `POST /replay` simultâneos para a
mesma entrada: `[200, 409]`; apenas 1 evento de replay é criado; `replayCount=1`.

**AC2c — resolve/discard com autorização e auditoria.** Sem token → 401; com
token não-admin → 403; `resolve` → `RESOLVED` com `resolution_reason` e
`resolved_by`; `discard` → `DISCARDED`; ambos com `audit_logs` (`dlq.resolve`).

**AC2d — consumidores independentes.** Após o worker ACKar um evento,
`GET /events` (consumidor `http-poll`, credencial interna) ainda o entrega;
ACK com geração errada → 409 sem marcar processado; ACK com o token do lease →
200 e o evento deixa de ser entregue àquele consumidor. O ACK do worker não
esconde o evento de realtime/http-poll (acks por consumidor).

Evidência: `prod-12-evidence.json` casos `AC2a…AC2d`,
`logs/lease-child`/`logs/ac2*-worker.log`, `logs/desk-api.log`.

---

## 4. AC3 — fanout realtime entre 2 processos

Topologia: 2 processos reais do `realtime-service` (portas 5331/5332) com
outbox no PG e bus Redis; assinantes WS autenticados pelo `/auth/me` do
desk-api real, todos com membership no setor da conversa (usuário A) ou sem
membership (usuário estranho).

- **AC3a:** um evento `handoff.completed` publicado no outbox (com hint
  pós-commit) chega **1×** ao assinante autorizado em cada réplica; após o
  ciclo de poll (dedup poll+bus, janela 60 s) os contadores seguem 1/1; o
  consumidor `realtime` ACKa o evento no outbox. Nenhuma duplicata.
- **AC3b:** o destinatário estranho tem o `subscribe` recusado (`error`) e
  **0** entregas de conteúdo, mesmo com o evento projetado globalmente
  (sanitizado).
- **AC3c:** removida a membership, as duas réplicas emitem
  `subscription.revoked` (≤5 s, aqui ~400 ms) e o novo evento não é entregue a
  nenhum dos assinantes; o consumidor realtime ainda processa/ACKa o evento
  (corta entrega, não perde o evento).

Evidência: `prod-12-evidence.json` casos `AC3a…AC3c`,
`logs/realtime-a.log`, `logs/realtime-b.log`.

---

## 5. AC4 — falha de processo no meio e DLQ entre restarts

**AC4a — SIGKILL externo durante o handler.** O handler fica preso no INSERT
do alerta (`pg_sleep(4)`) após o claim commitado; o processo é morto com
`SIGKILL` nessa janela. Resultado: 0 recibos, `processed_at NULL`, lease do
processo vítima. O lease expira (2 s), um segundo worker reivindica e conclui
**uma única vez** (1 recibo/1 alerta); os logs mostram o `Processing event` sem
`Successfully processed` na vítima e o sucesso no resgatador.

**AC4b — DLQ após esgotar tentativas atravessando restart.** O primeiro
processo registra o primeiro NACK (`retry_count=1`), é morto e um segundo
processo retoma do estado durável, esgota o orçamento e grava a DLQ
(`RETRY_BUDGET_EXHAUSTED`, `attempt_count=3`, `retry_count=3`,
`processed_at NULL`, 0 recibos). O log do segundo processo contém
`dead-lettered`; nenhuma perda silenciosa.

Evidência: `prod-12-evidence.json` casos `AC4a/AC4b`,
`logs/ac4a-*-victim.log`, `logs/ac4a-*-rescuer.log`, `logs/ac4b-*-w1.log`,
`logs/ac4b-*-w2.log`.

---

## 6. Comandos e exit codes

Suíte AC (última rodada, 13/13):

```bash
node scripts/production/run-integration-isolated.mjs --run-id prod12 --worker 40 -- \
  pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-12.test.ts
# exit 0 — Test Files 1 passed (1), Tests 13 passed (13)
```

Regressões (todas exit 0):

```bash
node scripts/production/run-integration-isolated.mjs --run-id prod12-reg-events --worker 41 -- \
  sh -c "pnpm --filter @cvg/events exec vitest run --exclude '**/aaa-07-lease-real.test.ts' \
         && pnpm --filter @cvg/events run test:real-db"          # 156 + 24 testes
node scripts/production/run-integration-isolated.mjs --run-id prod12-reg-worker --worker 42 -- \
  pnpm --filter @cvg/message-worker test                          # 13 testes
node scripts/production/run-integration-isolated.mjs --run-id prod12-reg-realtime --worker 43 -- \
  pnpm --filter @cvg/realtime-service exec vitest run --exclude '**/aaa-05-isolation.test.ts'  # 84 testes
node scripts/production/run-integration-isolated.mjs --run-id prod12-reg-dlq-b --worker 45 -- \
  pnpm --filter @cvg/desk-api exec vitest run \
    src/__tests__/dead-letter-routes.integration.test.ts \
    src/__tests__/events-polling.integration.test.ts              # 6 testes
```

Lint/typecheck dos arquivos da tarefa:

- `pnpm --filter @cvg/desk-api exec eslint src/__tests__/production/prod-12.test.ts` → exit 0.
- `pnpm --filter @cvg/events exec eslint src/outbox-lease.ts` → exit 0.
- `pnpm --filter @cvg/desk-api exec tsc --noEmit` → **sem erros em prod-12**;
  há erros pré-existentes de outros trabalhos ainda não finalizados no worktree
  (`prod-15.test.ts`, `modules/{alerts,notes,tasks,transfers}`), não tocados aqui.

SHA-256 do delta: `prod-12.test.ts` `6a5139988810e0f32c251ed104dccadea1aac4463971c6d36aef87fe7c2afce2` ·
`lease-child.ts` `6f0a91e9879b5936939e90569da511f9650eac07e787a1f842f79593e4782c64` ·
`outbox-lease.ts` (estado final, untracked) `41d1032a1722f28e238f15f200447a6cf5a71bf1879f9a0d735a367a2fda2506`.

---

## 7. Achados, riscos e limitações

1. **Fence de DLQ local→durável (corrigido).** `claim` filtrava o teto de retry
   pelo `maxRetries` do processo chamador; réplicas com configuração divergente
   (rolling deploy) podiam reclamar evento já dead-letterado e elevar
   `retry_count` (a DLQ continuava única, mas o "esgotado" não era durável).
   Corrigido com `NOT EXISTS dead_letter_events` no candidato; AC2a agora cobre
   explicitamente o worker divergente (`WORKER_MAX_RETRIES=5`).
2. **`claim(limit)` pode devolver menos que `limit` sob concorrência.**
   O `INSERT … ON CONFLICT DO UPDATE … WHERE` rejeita candidatos que outro
   processo reservou na mesma janela; o CTE não recua para os próximos
   candidatos. Exclusão permanece correta (nenhum duplo claim), mas drenar um
   backlog exige rodadas repetidas — comportamento exercitado em AC1b
   (4 rodadas). Consumidores não devem assumir "página cheia".
3. **Worker de produção não renova lease durante handlers longos.** O claim usa
   `WORKER_LEASE_SECONDS` (default 120 s) e não há heartbeat de renewal no loop
   do worker; um handler mais longo que o lease pode ser reivindicado em
   paralelo por outro processo. Os efeitos atuais são protegidos por recibos
   idempotentes (PROD-09) e pela idempotência da invocação (PROD-10), mas a
   recomendação é um heartbeat de `renew` enquanto o handler executa (mudança
   de worker, não necessária para os ACs desta prova).
4. **Configuração deve ser homogênea entre réplicas.** O teto durável de retry
   agora é o `dead_letter_events`; ainda assim, backoff/intervalo de poll
   divergentes alteram a latência de recuperação. Fence elimina o risco de
   "ressurreição" pós-DLQ.
5. **`aaa-07-lease-real.test.ts` não reexecutado.** A suíte fixa o run histórico
   `aaa-20260912-a7` (porta PG 56432) e a porta está ocupada por processo de
   outro run; mantém-se NOT_RUN conforme `CONTRATOS.md` (C04). A cobertura
   equivalente de lease foi executada aqui em PG isolado pelos cenários AC1.
6. **AC3 usa clientes WS no processo do teste; as réplicas e a API são
   processos reais.** O requisito "entre processos" é satisfeito pelos servidores
   (2 réplicas independentes + bus Redis + outbox compartilhado); a medição de
   revogação ≤5 s usa `subscription.revoked` nas duas réplicas.
7. **Falha de Redis/backoff/UI (AC4 do cartão)** não é o foco desta prova; a
   degradação explícita do bus é coberta por
   `packages/events/src/__tests__/realtime-bus.test.ts` e o polling durável
   segue como fallback. Readiness/backoff/UI verdadeira pertencem a PROD-32/33.

## 8. Mapa cartão → prova

| Critério do cartão | Onde foi provado |
|---|---|
| PROD-12-AC1 (claim exclusivo, renew, geração/owner, stale, recuperação) | AC1a/AC1b/AC1c/AC1d |
| PROD-12-AC2 (ACK de worker não esconde realtime/http-poll; HTTP cursor não avança sobre falha) | AC2d (independência de consumidores + stale 409); falha de ACK não fecha o evento (lease recuperável) em AC1c/AC4a |
| PROD-12-AC3 (DLQ sobrevive restart; retry admin autorizado/claim único/sourceEvent imutável/audit/resultados explícitos) | AC2a/AC2b/AC2c; envelope imutável comparado em AC2a |
| PROD-12-AC4 (backoff bounded, recuperação, estado verdadeiro) | AC4a/AC4b + regressão `realtime-bus` (degradação explícita); UI/backoff completo = PROD-32/33 |

## 9. Rollback

- Remover os arquivos novos: `apps/desk-api/src/__tests__/production/prod-12.test.ts`,
  `docs/producao-2026-09-13/evidencias/prod-12/**` (inclusive `lease-child.ts`).
- Reverter o único delta de produção: remover o bloco `AND NOT EXISTS
  (dead_letter_events …)` e os comentários correspondentes em
  `packages/events/src/outbox-lease.ts`. Sem schema/migration; rollback textual
  e imediato. O comportamento anterior (teto local por processo) já é coberto
  pelos testes existentes; nenhum dado é afetado.
- Nenhum dado do host foi tocado; todos os runs usam PG/Redis isolados e
  teardown por `runId`.

## 10. Reprodução

```bash
# 1) suíte PROD-12 (PG/Redis isolados; ~50 s)
node scripts/production/run-integration-isolated.mjs --run-id prod12 --worker 40 -- \
  pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-12.test.ts

# 2) evidência consolidada
cat docs/producao-2026-09-13/evidencias/prod-12/prod-12-evidence.json
ls docs/producao-2026-09-13/evidencias/prod-12/logs/
```
