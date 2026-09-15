# PROD-05 / AC4 — Auditoria de configuração: JWT legado vs arquitetura efetiva

**Data:** 2026-09-13 · **Candidato:** `754f9badac46278e77d21de91c58eedb15e80581` + worktree

## Configuração efetiva de `apps/desk-api`

- Sessões são **opacas** (`packages/auth/src/session-policy.ts`; token gerado em
  `auth.repository.ts:66-68` e persistido só como SHA-256) — nenhuma leitura de
  JWT no boot, no middleware ou nos controllers.
- Varredura de runtime (`grep -rn "JWT_SECRET" apps modules packages services
  --include=*.ts` excluindo testes/dist): **0 ocorrências**.
- Credencial interna efetiva (`apps/desk-api/src/internal-auth.ts:11-15`):
  `REALTIME_INTERNAL_SECRET` → `INTERNAL_EVENTS_SECRET` → `EVENTS_API_KEY`
  (primeiro configurado vence). O teste PROD-05 prova `/events` 401 sem chave e
  com Bearer de usuário, 200 com `INTERNAL_EVENTS_SECRET`.

## Ocorrências legadas de `JWT_SECRET`

| Local | Papel | Consome em runtime? |
|---|---|---|
| `.env.example:36` | documentação | Não |
| `scripts/production-readiness.mjs:20` | proíbe placeholder | Não |
| `scripts/production/run-integration-isolated.mjs:70` | valor sintético | Não |
| `e2e/support/aaa/start-aaa-stack.ts:31` | valor sintético | Não |
| `turbo.json:13` | globalEnv/hash | Não |

`INTERNAL_EVENTS_SECRET` é variável **com uso demonstrado** (guarda de
`/events` e `/events/:id/ack`) e aparece em compose/`.env` com o mesmo papel.

## Estado após a correção

- `docker-compose.yml` e `.env.production.example` não exigem mais `JWT_SECRET`.
- `apps/desk-api/src/runtime-config.ts` não valida nem usa a variável legada; a
  configuração efetiva continua exigindo `INTERNAL_EVENTS_SECRET` ou seu alias suportado.
- `scripts/production-readiness.mjs` ainda rejeita o placeholder legado como defesa
  de compatibilidade do gate. Isso não habilita nem usa JWT e continua coberto por PROD-36.

## Resolução aplicada

- **Prova (in-scope):** `prod-05.test.ts` sobe o app real com `JWT_SECRET`
  removido do ambiente, valida login/me/rotate com token opaco (não-JWT), varre
  `apps/desk-api/src` e `packages/auth/src` por `JWT_SECRET|jsonwebtoken|jwt.sign|jwt.verify`
  (0 hits, excluindo testes) e exercita a guarda interna por
  `INTERNAL_EVENTS_SECRET`.
- **Correção aplicada:** removida a validação runtime legada de `JWT_SECRET` e alinhados
  `docker-compose.yml`/`.env.production.example`; nenhuma variável nova foi inventada.
  A decisão de remover também a defesa do `production-readiness.mjs` permanece no gate PROD-36.

## Evidência

- `prod-05-probes.json` — probes AC4 (`/events` 401/401/200).
- `logs/realtime-child.log`, `logs/desk-api.log` — boot e operação sem JWT.
- `logs/auth-tests.log` — `pnpm --filter @cvg/auth test` exit 0.
