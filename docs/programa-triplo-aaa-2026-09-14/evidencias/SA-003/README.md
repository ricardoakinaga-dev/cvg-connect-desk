# SA-003 — Runner e dependências de teste isolados

**Candidato:** HEAD 754f9bad + worktree. **Ambiente:** host ricardo, Node 24.20.0, pnpm 10.33.0.

## Artefatos e provas

| Arquivo | Prova |
|---|---|
| `runner-migrate-summary.json` | migração real (`db:types`→`db:migrate`) aplicada na URL isolada `cvg_aaa_sa003_migrate_w24` (42 tabelas, 1 linha de marcador); env permitido registrado com segredos mascarados; cleanup ao final |
| `runner-migrate-cleanup.json` | teardown apenas dos recursos do próprio run (PostgreSQL/Redis com PID próprios) |
| `runner-selftest-summary.json` | controle negativo: comando falha com exit 7, runner registra e encerra só os recursos próprios |
| `runner-selftest-cleanup.json` | cleanup de sucesso após falha do comando (exit 0 do runner) |
| `../../docker-compose.aaa-storage.yml` + `storage-scanner-selfcheck.json` | MinIO/ClamAV efêmeros com projeto exclusivo `cvg-aaa-<runId>`, tmpfs, credenciais sintéticas e guardas: porta ocupada (`PORT_BUSY`), marcador de outro projeto (`MARKER_CONFLICT`), teardown alheio recusado, runId hostil recusado/sanitizado |

## Guardas de isolamento verificados

- PG/Redis: portas derivadas do worker (56432/56680 + índice), banco `cvg_aaa_*`, host remoto/porta divergente/nome sem marcador rejeitados por `assertIsolatedDatabaseUrl`/`assertIsolatedRedisUrl` (selfcheck do harness AAA).
- Storage/scanner: nunca `fuser` nem nome fixo; teardown é `docker compose -p cvg-aaa-<runId> down -v`.
- Saída sanitizada: URLs com senha, `password/secret/token/api_key/authorization` e chaves PEM são mascaradas antes de gravar.
- Limitação: um PostgreSQL órfão anterior (`aaa-20260912-w42`, PID 2738421) segue ativo de execução histórica e **não foi tocado**; não pertence a este run.
