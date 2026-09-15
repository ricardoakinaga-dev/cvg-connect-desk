# PROD-04 — AC3: fonte efetiva de permissões (delta sobre IMPLEMENTED)

**Data:** 2026-09-13 · **Executor:** execução AC3/AC2-resíduo sobre o delta já
registrado em `RELATORIO.md` · **Decisão:** D01 OPEN — implementado o default
técnico recomendado (fonte no banco) sem ratificar catálogo de produto.

**Candidato:** `754f9badac46278e77d21de91c58eedb15e80581` + worktree (não
commitado). **Ambiente:** PostgreSQL 16 + Redis isolados do harness AAA via
`scripts/production/run-integration-isolated.mjs` (nunca o banco do host).

| Run | Marcador | PG/Redis | Evidência |
|---|---|---|---|
| `prod04-perms` (worker 13) | `cvg_aaa_prod04_perms_w13` | 57732/56810-ish (isolados) | `evidencias/integration-runs/prod04-perms/` + `logs/prod-04-ac3-db.log` |
| `prod04-kanban` (worker 13) | `cvg_aaa_prod04_kanban_w13` | isolados | `evidencias/integration-runs/prod04-kanban/` |
| `prod04-fix` (worker 20) — **correção F1/F2/F3/F5** | `cvg_aaa_prod04_fix_w20` | 58432/56880 (isolados) | `integration-runs/prod04-fix/` + `logs/prod-04-fix.log` + `matrix.json` (175 probes) |
| `prod04-regressao-fix` (worker 22) | `cvg_aaa_prod04_regressao_fix_w22` | 58632/56900 (isolados) | `integration-runs/prod04-regressao-fix/` + `logs/regressao-fix.log` |

Estado do cartão: **AC3 implementado com prova; aguardando revisão do
integrador — NÃO declarado DONE** (D01 continua OPEN; ver §6).

## 1. Problema reproduzido (antes) e correção

Antes deste delta, `requirePermission`/helpers decidiam apenas pelo catálogo
ESTÁTICO por NOME de papel (`RolePermissions`, `packages/auth/src/rbac.ts`); as
tabelas `permissions`/`role_permissions` existiam mas NADA as consultava em
runtime (registrado em `RELATORIO.md` §5.2 e Risco 1: o papel customizado era
sempre negado). A própria suíte `kanban-routes.integration.test.ts` falhava
2/2 codificando esse comportamento.

Repro do contrato novo (mesma sessão, mesma rota, banco editado):

| Passo (probe `AC3.5`, `GET /conversations`, papel customizado) | Antes da edição | Depois de `chat:read` | Depois de revogar |
|---|---|---|---|
| status HTTP | **403** | **200** (com `CONTEUDO-A-*`) | **403** |
| corpo | sem conteúdo | conversa do setor | sem conteúdo |

`AC3.6` (kanban move, papel customizado com membership de escrita):
**403 → grava `chat:write` → 200 → revoga → 403**. `AC3.7` (papel built-in
editável, Manager): **200 → revoga `chat:read` → 403 → restaura → 200**.
Nenhum cache de sessão: a decisão muda na requisição seguinte.

## 2. Delta (arquivos e linhas no estado atual)

### Fonte efetiva

- `packages/auth/src/permission-service.ts` (novo) — `resolveUserAccess`
  (`:41-54`, UMA query: `user_roles` inner `roles` left `role_permissions` left
  `permissions`), `collapseAccessRows` (`:26-38`), `resolveEffectivePermissions`
  (`:57-60`, retorna `Set<string>`). Documenta que a fonte autoritativa passa a
  ser o banco e o estático vira fallback legado.
- `packages/auth/src/rbac.ts:91-142` — `isBuiltInRole`, `builtInRolesGrant`,
  `hasAuthoritativePermissions` e `actorGrantsPermission`: instalação
  provisionada (`permissionsAuthoritative`) ou `permissions` não vazio é
  autoritativo (inclusive Admin, mesmo VAZIO = nega); apenas instalação legada
  (sem `role_permissions`) cai no estático e só para built-in.
- `packages/auth/src/permission-service.ts:15-93` — `UserAccess.permissionsAuthoritative`,
  `isRolePermissionsProvisioned` (checa `role_permissions`, cache de 5 s) e
  `resolveUserAccess` resolvendo acesso + flag (F1).
- `packages/auth/src/middleware.ts:6,49-76` — `authenticate` resolve papéis +
  permissões + flag e anexa `request.user.permissions`/`permissionsAuthoritative`.
- `packages/auth/src/rbac-middleware.ts:12-16,30-55` — declaração do campo e
  `requirePermission` decidindo por `actorGrantsPermission`; log inclui a
  contagem de permissões efetivas.
- `packages/auth/src/resource-authz.ts:4-16,89-113` — `ResourceActor.permissions?`/
  `permissionsAuthoritative?` e decisão de ação por fonte efetiva (Admin deixa
  de ter bypass quando existe conjunto do banco).
- `packages/auth/src/authorize.ts:15-28,99-106` — `AuthzActor.permissions?`/
  `permissionsAuthoritative?` e `authorize()` usa a fonte efetiva; override de
  Admin permanece só no modo legado.
- `packages/auth/src/index.ts:3-4` — exporta `permission-service`.

### Provisionamento

- `packages/database/supabase/migrations/0025_role_permissions_backfill.sql`
  (novo) — idempotente: garante papéis built-in (`:26-28`), as 15 permissões do
  catálogo vigente (`:31-48`) e as associações de `RolePermissions` para
  Admin/Receptionist/Veterinarian/Manager (`:51-80`) com
  `ON CONFLICT DO NOTHING`. Nenhuma coluna/tabela muda.
- `packages/database/supabase/migrations/meta/_journal.json:178-185` — entrada
  idx 25 (`0025_role_permissions_backfill`).
- `packages/database/src/seed.ts:29-131` — mesmas 15 permissões + `audit:read`
  e catálogo de associação idempotente por papel (`onConflictDoNothing`), sem
  mais “tudo para o Admin”.

### AC2 resíduo — gates adicionados (somente ação, sem tocar lógica de recurso)

- `modules/labels/src/presentation/http/label.controller.ts:31` — `GET /labels`
  → `chat:read` (rotas de conversa/contato já passavam por helpers com ação).
- `modules/transfers/src/presentation/http/transfer.controller.ts:209/250/277`
  — `GET /transfers` → `chat:read`; `POST /transfers/:id/accept|reject` →
  `chat:write` (POST /transfers e histórico seguem cobertos por helper).
- `modules/contact-groups/src/presentation/http/contact-group.controller.ts:88/154`
  — `GET /contact-groups` e `GET /contact-groups/:id/members` → `chat:read`;
  CRUD já tinha `admin:write`; membros add/remove agora têm
  `requirePermission('chat:write')` **+** `authorizeGroup` local (F3, corrigido
  na revisão; ação canônica `chat:write` por ser composição operacional de
  grupo e preservar a autorização por membership de setor).
- `modules/sectors/src/presentation/http/sector.controller.ts:9/136` —
  `GET /sectors` → `chat:read`; `GET /sectors/stats/overview` →
  `dashboard:read`. Subrotas por setor seguem em `requireSectorAccess`.

### Testes/evidência

- `apps/desk-api/src/__tests__/kanban-routes.integration.test.ts` — papel
  customizado com `role_permissions` gravado (chat:read/chat:write) e caso
  dedicado de concessão/revogação (`AC3: revogar/conceder role_permissions
  altera a decisão da mesma operação`).
- `apps/desk-api/src/__tests__/production/prod-04.test.ts` — novos
  `AC3.5`–`AC3.8` (custom negado → concedido → revogado; escrita kanban;
  built-in editável; backfill da 0025) e `AC2.8` (listas/estatísticas
  residuais com atores sem permissão/custom/built-in).
- `packages/auth/src/__tests__/` — `permission-service.test.ts`,
  `rbac-effective.test.ts`, `rbac-middleware.test.ts`; casos de fonte efetiva
  em `authorize.test.ts` e `resource-authz.test.ts`; **revisão F1** adiciona o
  flag provisionado/vazio (60 testes no total em `logs/auth-unit-fix.log`).
- `docs/producao-2026-09-13/evidencias/prod-04/PERMISSOES.md` (este),
  `matrix.json` (**175 probes**, run `prod04-fix`, 0 divergentes),
  `logs/prod-04-fix.log`, `logs/regressao-fix.log`, `logs/auth-unit-fix.log`,
  `evidencias/integration-runs/*`.
- `apps/desk-api/src/__tests__/production/prod-04.test.ts` — revisão F1–F3/F5:
  `AC1.7` (TOCTOU com `sectorId`), `AC2.9` (contact-group membros), `AC3.9`
  (custom com/sem `sectorId`), `AC3.10` (built-in sem NENHUMA permissão).

## 3. Repro e comandos (exit)

| # | Comando | Exit | Resultado |
|---|---|---|---|
| 1 | `node scripts/production/run-integration-isolated.mjs --run-id prod04-perms --worker 13 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-04.test.ts` | **0** | **23/23** testes; `matrix.json` 162 probes, 0 fora do esperado; AC3.5/3.6 403→200→403 |
| 2 | `node scripts/production/run-integration-isolated.mjs --run-id prod04-kanban --worker 13 -- pnpm --filter @cvg/desk-api exec vitest run --no-file-parallelism src/__tests__/kanban-routes.integration.test.ts src/__tests__/sector-authz.integration.test.ts src/__tests__/labels-routes.integration.test.ts src/__tests__/transfers-routes.integration.test.ts src/__tests__/contacts-routes.integration.test.ts src/__tests__/contact-groups-routes.integration.test.ts` | **0** | **59/59** testes (kanban 3/3, sector-authz 9, labels 11, transfers 10, contacts 14, contact-groups 12) |
| 2b | `node scripts/production/run-integration-isolated.mjs --run-id prod04-regressao2 --worker 14 -- pnpm --filter @cvg/desk-api exec vitest run --no-file-parallelism src/__tests__/dynamic-permissions.integration.test.ts src/__tests__/chat-routes.integration.test.ts src/__tests__/sectors-routes.integration.test.ts src/__tests__/auth-routes.integration.test.ts` | **0** | **25/25** testes (sessão dinâmica, chat, setores, `/auth/me`) |
| 3 | `pnpm --filter @cvg/auth test` | **0** | **48/48** testes (6 arquivos) |
| 4 | `pnpm --filter @cvg/database test` | **0** | 27/27 testes |
| 5 | `pnpm --filter @cvg/auth typecheck` / `@cvg/database` / `@cvg/desk-api` / `@cvg/labels` / `@cvg/transfers` / `@cvg/contact-groups` / `@cvg/sectors` / `@cvg/kanban` / `@cvg/realtime-service` | **0** | `tsc --noEmit` limpo |
| 6 | `pnpm --filter @cvg/auth lint` / `@cvg/database` (ambos `--max-warnings 0`) e `@cvg/desk-api` / `@cvg/labels` / `@cvg/transfers` / `@cvg/contact-groups` / `@cvg/sectors` | **0** | sem erros; warnings pré-existentes dentro do teto dos pacotes |
| 7 | **Revisão F1–F3/F5** — `node scripts/production/run-integration-isolated.mjs --run-id prod04-fix --worker 20 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-04.test.ts` | **0** | **27/27**; matrix 175 probes, 0 divergentes; AC3.10/AC3.9/AC2.9/AC1.7 novos |
| 8 | **Revisão F1–F3/F5** — `node scripts/production/run-integration-isolated.mjs --run-id prod04-regressao-fix --worker 22 -- pnpm --filter @cvg/desk-api exec vitest run --no-file-parallelism src/__tests__/kanban-routes.integration.test.ts src/__tests__/sector-authz.integration.test.ts src/__tests__/dynamic-permissions.integration.test.ts src/__tests__/contact-groups-routes.integration.test.ts src/__tests__/chat-routes.integration.test.ts` | **0** | **31/31** (kanban 3, sector-authz 9, dynamic-permissions 2, contact-groups 12, chat 5) |
| 9 | **Revisão F1–F3/F5** — `pnpm --filter @cvg/auth test` | **0** | **60/60** (6 arquivos; `logs/auth-unit-fix.log`) |

Evidência bruta dos runs 1–2b: `evidencias/integration-runs/<run-id>/runner-summary.json`
(steps `db:types`/`db:migrate`/`db:seed`/`command` todos `0`) e
`runner-output.log`. O seed registrou as 15 associações do Admin, 8 da
Receptionist, 9 da Veterinarian e 9 da Manager, provando a idempotência.

## 4. Matriz de rotas (ação × cobertura)

| Módulo / rota | Gate de ação | Observação |
|---|---|---|
| chat `GET /conversations`, `GET .../messages` | `chat:read` | delta anterior preservado |
| chat `POST /messages`, mídia | `chat:write` | delta anterior preservado |
| kanban `GET /kanban/board|filters` | `chat:read` | + escopo de setor |
| kanban `PATCH /kanban/card/:id/move|assign` | `chat:write` | origem (helper) + destino (`authorizeSectorScope`) |
| contacts lista/detalhe/stats, labels de contato | `chat:read` (`contacts:read`) | helpers com ação |
| contacts criar/atualizar/start-conversation | `chat:write` (`contacts:write`) | exceção D-AUTHZ-01 mantida |
| contacts delete | `admin:write` | |
| tutors/patients lista/detalhe/stats | `chat:read` | |
| tutors/patients criar/atualizar | `chat:write` | |
| tutors/patients delete | `admin:write` | |
| tasks lista/detalhe | `tasks:read` | |
| tasks criar/atualizar | `tasks:write` | |
| alerts lista/detalhe | `alerts:read` | |
| alerts ack/resolve/criar | `alerts:write` | |
| notes lista/detalhe | `notes:read` | |
| notes criar | `notes:write` | |
| admin (users/roles/permissions/queues/teams/DLQ) | `admin:read` / `admin:write` | |
| audit | `admin:read` | delta anterior preservado |
| privacy DSAR | `admin:read` / `admin:write` | delta anterior preservado |
| dashboard (`/metrics/*`) | `dashboard:read` | |
| labels `GET /labels` | `chat:read` | **novo** (AC2 resíduo) |
| labels conversa/contato | helper `chat:*` / `contacts:*` | não duplicado |
| transfers `GET /transfers` | `chat:read` | **novo** |
| transfers `POST /:id/accept|reject` | `chat:write` | **novo** |
| transfers `POST /transfers`, `GET /contacts/:id/transfers` | helper `contacts:write|read` | não duplicado |
| contact-groups `GET /contact-groups`, `GET /:id/members` | `chat:read` | **novo** |
| contact-groups CRUD | `admin:write` | |
| contact-groups membros add/remove | `chat:write` + `authorizeGroup` local (admin:read/write ou membership) | F3: gate de ação adicionado, escopo de recurso preservado |
| sectors `GET /sectors` | `chat:read` | **novo** |
| sectors `GET /sectors/stats/overview` | `dashboard:read` | **novo** |
| sectors `/:id/conversations`, `/:id/stats` | `requireSectorAccess` (membership) | inalterado |
| sectors CUD | `admin:write` | |

Prova HTTP da matriz residual: `AC2.8` (`noRole`/custom → 403, built-in → 200)
em `matrix.json`; rotas já cobertas por helper não receberam gate duplicado.

## 5. Aceites

- **AC3 (fonte efetiva)** — `resolveUserAccess` consulta o banco em uma query e
  `authenticate` anexa `permissions`; `requirePermission`/helpers/`authorize`
  decidem pela fonte efetiva quando provisionada. `AC3.5`/`AC3.6` provam em
  HTTP+PG real: papel customizado **negado**, passa após gravar
  `role_permissions` e **volta a negar** após revogar (mesma sessão, sem
  cache). `AC3.7` prova o mesmo para papel built-in editável. `AC3.8` prova o
  backfill idempotente da 0025. `401` sem sessão, `403` sem ação/nível e `404`
  sem membership/vínculo mantidos; IDs adulterados seguem `404`.
- **AC2 (resíduo)** — listas/estatísticas de labels, transfers,
  contact-groups, sectors ganharam gate de ação; `AC2.8` prova 403/403/200. Os
  gates anteriores (negação por ação+recurso, TOCTOU no repository, Kanban com
  ação, WS) não foram enfraquecidos: AC1/AC2/AC4 continuam verdes (23/23) e as
  regressões setoriais 59/59.
- **Compatibilidade legada** — ator sem o campo `permissions` mantém o
  catálogo estático (realtime-service); instalação legada (sem
  `role_permissions`) também; instalação provisionada é autoritativa mesmo com
  conjunto vazio (F1); custom sem permissão é negado.
- **D01** — implementado o default técnico registrado (fonte no banco) sem
  ratificar nomes/finalidades do catálogo de produção.

## 6. Riscos e limitações (honestos)

1. **D01 continua OPEN**: o catálogo provisionado é o vigente em código
   (Admin/Receptionist/Veterinarian/Manager). Ratificar o catálogo de produção
   (e o editor de PROD-26) segue pendente; nada de produto foi ratificado aqui.
2. **Fallback de built-in (corrigido na revisão — F1)**: o fallback estático
   só vale quando a INSTALAÇÃO não está provisionada (nenhuma linha em
   `role_permissions`). Pós-0025/seed, o conjunto resolvido é autoritativo
   MESMO VAZIO: revogar TODAS as permissões de um built-in **nega** (403),
   inclusive Admin; reconceder restaura. A decisão usa
   `permissionsAuthoritative` (resolvido em `resolveUserAccess`, cache ≤5 s) e
   está coberta por `AC3.10` + unitários (`logs/auth-unit-fix.log`, 60/60).
3. **WS/realtime sem o flag de provisionamento**: `apps/realtime-service` está
   fora do escopo de escrita e passa `permissions` sem
   `permissionsAuthoritative` (`authorization.ts:45,102,128`); com conjunto
   vazio ele mantém o fallback estático. Uma revogação TOTAL de
   `role_permissions` reflete no HTTP na hora (F1) mas não no gate de
   subscription do WS; membership/sessão continuam cortando conteúdo. Fronteira
   a fechar em PROD-04/PROD-05 antes de DONE (registrada em `RELATORIO.md` §8).
4. **Custo**: uma query por requisição autenticada (joins cobertos por
   `user_roles_pkey` e `role_permissions_pkey`); sem cache por decisão — é o
   que garante efeito imediato da edição.
5. **`authorizeGroup` (contact-groups)**: os add/remove de membro continuam
   decidindo por `admin:read/write` estático + membership do setor (lógica de
   recurso revisada não foi alterada); um papel cujo `admin:write` exista
   somente no banco não ganha esses dois endpoints além do que o gate de rota
   já exige. Sem regressão.
6. **Migration 0025 cria papéis built-in ausentes** para que o backfill valha
   em banco recém-migrado (o seed já fazia o mesmo); um cluster que tenha
   removido deliberadamente um built-in o recria com as permissões do catálogo.
   Idempotente e sem DDL.
7. **`/auth/me` agora devolve `permissions`** (do próprio usuário). Sem novo
   vazamento, mas altera o payload do contrato.
8. Carga/EXPLAIN da query de permissões e o fanout de WS multi-réplica não
   foram reexecutados (fronteira PROD-08/12/33).

## 7. Rollback

- Reverter o delta de código: `packages/auth/src/{permission-service.ts (novo),
  rbac.ts, middleware.ts, rbac-middleware.ts, resource-authz.ts, authorize.ts,
  index.ts}` e os gates adicionados nos quatro controllers; testes e evidências
  são aditivos.
- Banco: a 0025 é aditiva e reversível por dados (`DELETE FROM role_permissions
  ...`/remoção da linha do ledger do tag 0025); nenhuma coluna/tabela foi
  criada ou alterada. Reverter o código sem reverter a 0025 é inócuo (o código
  anterior volta a ignorar `role_permissions`).
- Runs isolados `prod04-perms`/`prod04-kanban` já derrubados; nenhum banco do
  host foi tocado.

## 8. Próxima ação

Integrador: revisar o delta, decidir D01 sobre o catálogo de produção e
reconciliar a fonte efetiva no gate WS (`realtime-service`) antes de DONE;
crítico fresco deve reproduzir `AC3.5`/`AC3.6` (403→200→403) e ler o
`matrix.json`, sem aceitar este relato como prova.
