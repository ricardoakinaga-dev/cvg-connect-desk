# SA-007 — Rework R2 (typecheck + teardown confiável)

**Candidato:** HEAD `754f9badac46278e77d21de91c58eedb15e80581` + worktree; o manifesto do candidato é regenerado após esta onda (a versão anterior é histórica e não incluía a spec de browser da SA-008).

## Achado R2-F02

`apps/desk-api/src/__tests__/sa-007-start-conversation.integration.test.ts:83` chamava `db.close?.()`; o tipo público do banco (`NodePgDatabase`) não expõe `close`, quebrando `pnpm typecheck` (32/33).

## Correção

- Removida a chamada inválida.
- O teardown do arquivo agora encerra a app Fastify e, em seguida, o **pool pg real** via `getPool().end()` (API pública de `@cvg/database`), devolvendo as conexões ao run isolado sem `cast` inseguro.
- Nenhuma asserção foi enfraquecida; os 5 casos de atomicidade/concorrência permanecem.

## Provas

| Prova | Comando | Resultado |
|---|---|---|
| Typecheck focado | `pnpm --filter @cvg/desk-api exec tsc --noEmit` | exit 0 |
| Typecheck completo | `pnpm typecheck` | exit 0 — **33/33 tasks** (`typecheck.log`) |
| Integração isolada SA-007 | `run-integration-isolated --run-id sa007-rework --worker 43 --skip-seed -- vitest run sa-007-start-conversation.integration.test.ts` | **5/5 PASS**, exit 0 (`rework/runner-summary.json`) |
| Cleanup do run | `runner-cleanup.json` | PG/Redis do run encerrados |

## Limitações

- O `getPool().end()` encerra o pool do processo do arquivo; outros arquivos do desk-api rodam em ambientes separados (`fileParallelism: false` mantém o banco determinístico).
- A revisão independente do rework é registrada em `evidencias/revisoes/R2-sa007-sa008-critic.md`.
