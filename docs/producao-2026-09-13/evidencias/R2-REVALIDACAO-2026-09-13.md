# Revalidação R2 — worktree integrado

Data: 2026-09-13. Esta nota registra a revalidação do delta R2 no worktree
atual. Os comandos de integração usaram o harness PostgreSQL/Redis local, com
bancos e portas exclusivos por execução, e teardown ao final. Não houve acesso
ao banco padrão da aplicação nem deploy.

## Resultados

| Prova | Execução | Resultado |
|---|---|---|
| PROD-07 | `prod07-repair-20260913`, PG 56852, Redis 56900 | 9/9 PASS |
| PROD-10 | `prod10-repair-20260913b`, PG 56862, Redis 56910 | 7/7 PASS |
| PROD-13 | `prod13-repair-20260913b`, PG 56842, Redis 56890 | 11/11 PASS |
| PROD-04 | runner isolado `prod04-r2`, worker 10, PostgreSQL + Redis + WS | 27/27 PASS |
| PROD-05 | runner isolado `prod05-r2b`, worker 15, PostgreSQL + Redis + WS | 17/17 PASS |
| PROD-06 | runner isolado `prod06-r2`, worker 8, fresh/upgrade PostgreSQL | 12/12 PASS |
| Secretary adapter | PostgreSQL temporário `cvg_local_secretary_20260913` em PG 56432 | 51/51 PASS |
| Chat Secretary boundary | testes unitários com dependências externas isoladas | 5/5 PASS |
| Shared webhook | suíte focada | 28/28 PASS |
| PROD-14 + BE-A04 | runner isolado `prod14`, worker 23, ClamAV real + moto S3 | 13/13 PASS |
| PROD-15 | runner isolado `prod15`, worker 41, ClamAV real + moto S3 | 12/12 PASS |
| PROD-16 | runner isolado `prod16`, worker 25, PostgreSQL + HTTP | 9/9 PASS; D02 continua OPEN |
| PROD-18 | runner isolado `prod18-r2b`, worker 28, PostgreSQL + HTTP | 18/18 PASS |
| Migration check | `prod14-migcheck`, worker 45, fresh DB | PASS: 41 tabelas + migration 0029 |
| Message worker | suíte local | 16/16 PASS; `/metrics` com token passou |
| Realtime metrics | suíte local `realtime-health.test.ts` com HTTP real | 3/3 PASS; `/metrics` fail-closed + Bearer |
| Realtime suite | local sem `aaa-05` + `aaa-05` no runner `realtime-metrics-r2` | 87/87 + 14/14 PASS |
| Desk web | suíte Vitest local | 268/268 PASS |
| Media sem banco | S3/ClamAV protocol tests | 14/14 PASS, 6 skipped por flags reais |
| Chat sem AAA-08 | suíte local | 24/24 PASS, 6 skipped |

## Mudanças verificadas

- Replay de webhook concluído retorna HTTP 200 com `deduplicated: true`.
- Payload diferente continua HTTP 409; assinatura/timestamp inválidos continuam
  HTTP 401; falha transitória do store continua HTTP 500.
- Invocação Secretary `unknown` não é reaberta automaticamente; `processing`
  não inicia uma segunda chamada externa.
- Retry legítimo ocorre somente a partir de `failed`, com `expectedAttemptCount`
  protegendo as transições por CAS.
- Timeout/erro ambíguo registra `unknown`, reconhece o evento e não envia para
  DLQ por retry cego.
- `invocationId` estável é propagado no header `Idempotency-Key` e no campo
  `invocation_id`; o teste PROD-10 confirma a mesma chave em todos os retries.
- Budget durável, concorrência, deny-default D05, hash canônico, expiração,
  revisor e uso único passaram na prova real PROD-13.
- Recovery de mídia agora reclama atomicamente por `FOR UPDATE SKIP LOCKED`, usa
  lease/backoff/limite duráveis, inclui `SCAN_FAILED` e roda no mesmo poller
  no-overlap do `message-worker`.
- A prova BE-A04 confirmou scanner indisponível → recuperação CLEAN, timeout
  `SCAN_FAILED` → recuperação, uma única reclamação concorrente e retry
  bounded sem hot loop.
- `message-worker` agora expõe métricas Prometheus autenticadas; produção e
  staging materializam o token em tmpfs e o worker recebe S3/ClamAV/recovery.
- `realtime-service` agora expõe `/metrics` com a mesma política fail-closed do
  worker; Compose/staging fornecem o token e o scrape Prometheus usa
  `/tmp/metrics_token`.

## Verificações estáticas

- `pnpm --filter @cvg/secretary-adapter typecheck` — PASS.
- `pnpm --filter @cvg/integrations typecheck` — PASS.
- `pnpm --filter @cvg/chat typecheck` — PASS.
- `pnpm --filter @cvg/message-worker typecheck` — PASS.
- `pnpm --filter @cvg/realtime-service typecheck` — PASS.
- `pnpm --filter @cvg/desk-api typecheck` — PASS.
- `pnpm --filter @cvg/database typecheck` — PASS.
- `pnpm --filter @cvg/media typecheck` — PASS.
- `git diff --check` — PASS.
- ESLint nos arquivos tocados — PASS; realtime mantém 26 warnings baseline já
  conhecidos, sem erros novos.

## Limitações

- Os providers Secretary/Gateway foram sandboxes HTTP locais; o contrato
  externo ainda requer confirmação operacional.
- D01–D06 continuam `OPEN`; em particular, D05 mantém ferramentas IA
  desabilitadas por padrão.
- PROD-40/revisão independente, manifest digest, Docker/Compose, TLS/WSS,
  browser E2E, UI real de anexos e demais fluxos de atendimento permanecem
  pendentes; PROD-16/PROD-18 foram apenas revalidados nas provas acima.
- MinIO e execução completa de Compose continuam BLOCKED pela permissão do
  socket Docker; moto S3 e ClamAV real cobrem apenas o sandbox desta revisão.
- O teste BE-A04 reproduz o estado órfão pós-commit antes do enqueue e prova a
  recuperação, mas ainda não executa `SIGKILL` físico entre essas duas etapas.
- Esta nota não é certificação final nem autorização de implantação.
