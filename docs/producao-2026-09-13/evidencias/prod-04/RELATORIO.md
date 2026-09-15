# PROD-04 — Relatório de execução (HTTP/WS: ação + recurso)

**Data:** 2026-09-13 · **Run isolado original:** `prod04-20260913` (worker 10) ·
**Correção pós-revisão:** runs `prod04-fix` (worker 20) e `prod04-regressao-fix`
(worker 22) — ver §8 · **Candidato:**
`754f9badac46278e77d21de91c58eedb15e80581` + worktree (não commitado)
**Ambiente:** PostgreSQL 16 e Redis isolados do harness AAA
(`cvg_aaa_prod04_20260913_w10` em 127.0.0.1:57432 / 127.0.0.1:56780; nunca o
banco do host). Teardown executado com `--stop-services --drop-database`.

Estado do cartão: **IMPLEMENTED / aguardando revisão do integrador — não
declarado DONE**. D01 permanece OPEN (ver Riscos).

## 1. Problema reproduzido (antes do delta)

Script `repro.ts` executado no candidato atual antes das edições
(`logs/repro-antes.log`), com PG/Redis reais:

| Probe | Achado | Resultado antes |
|---|---|---|
| B_E04 rota `GET /conversations` sem `sectorId` com ator **sem role** e membership | BE04 | **HTTP 200** devolvendo a conversa do setor (`vazouConversaDoSetor: true`) |
| B_E04 helper puro `authorizeConversationResource` com ator sem role | BE04 | `{"allowed": true}` |
| B_E17 `findPage({userId})` após membership revogada (TOCTOU entre checagem e query) | BE17 | **1 item** retornado, conversa do setor vazando (`vazouConversaDoSetor: true`) — a query tratava ausência de memberships como “admin global, não filtra” |

Contraprova com o delta aplicado (`logs/repro-depois.log`):

| Probe | Resultado depois |
|---|---|
| Rota sem role | **403**, nenhuma conversa |
| Helper sem role | `{"allowed": false, "statusCode": 403, "error": "FORBIDDEN", "message": "Missing permission for this action"}` |
| Query pós-revogação | **0 itens** (deny-by-default); `globalAdmin: true` explícito continua vendo tudo |

## 2. Delta (arquivos e linhas no estado atual)

### packages/auth
- `packages/auth/src/rbac.ts:18-38` — catálogo canônico `ALL_PERMISSIONS` + `isPermission()` (nenhum nome novo de permissão foi criado).
- `packages/auth/src/resource-authz.ts:59-96` — alias explícito de ações de recurso (`kanban:*`, `contacts:*`) para o catálogo e `actorHasActionPermission` (Admin global com override; papel desconhecido/negado = false; ação fora do catálogo = deny).
- `packages/auth/src/resource-authz.ts:112-121,171-180,229-238,281-290` — `authorizeConversationResource` / `authorizeContactResource` / `authorizeTaskResource` / `authorizeAlertResource` negam com **403** quando nenhum papel do ator tem a permissão da ação, antes do escopo de membership.
- `packages/auth/src/resource-authz.ts:330-345` — `authorizeSectorScope` aceita `action?` e nega quando informada e sem permissão (callers in-scope e realtime passam a ação).
- Testes novos: `packages/auth/src/__tests__/resource-authz.test.ts` (8 casos puros, sem banco).

### modules/chat
- `modules/chat/src/presentation/http/outbound.controller.ts:204` — `GET /conversations` com `preHandler: [authenticate, requirePermission('chat:read')]`.
- `outbound.controller.ts:226-252` — papel global explícito (`roles.includes('Admin')` **ou** `sectorPermissionService.isGlobalAdmin`) calculado uma vez; recusa antecipada mantida; `filters` passa `globalAdmin`.
- `modules/chat/src/infrastructure/repositories/conversation.repository.ts:8-23` — `ConversationListFilters.globalAdmin?: boolean`.
- `conversation.repository.ts:56-65` — `globalAdmin` entra no hash do escopo do cursor.
- `conversation.repository.ts:103-134` — `buildConversationConditions`: `globalAdmin === true` não filtra; caso contrário relê memberships e, se vazias, aplica `sql`false`` (deny-by-default). A rota não é confiada (TOCTOU).

### modules/kanban
- `kanban.controller.ts:24` — board com `chat:read`; `:89` helper com `action: 'chat:read'`.
- `kanban.controller.ts:221` — move com `chat:write`; `:251` helper `chat:write`; `:260-265` destino autorizado via `authorizeSectorScope` com `action: 'chat:write'`.
- `kanban.controller.ts:278-300` — `/kanban/filters` com `chat:read` e setores filtrados por membership para não-admin.

### modules/contacts
- `contact.controller.ts:85/105/350` — listar/buscar/estatísticas com `chat:read`; `:173/201/250` — criar/atualizar/iniciar conversa com `chat:write`; `:231` delete segue `admin:write`.
- Helpers passaram a usar ações canônicas (`chat:read`/`chat:write`) e `authorizeSectorScope` recebe `action: 'chat:write'`. Exceção existente documentada **D-AUTHZ-01** permanece explícita (`contact.controller.ts:58` e comissão do contato sem vínculo); agora exige a permissão de ação.

### modules/tutors / modules/patients
- `tutor.controller.ts:15/20/38` e `patient.controller.ts:18/23/45` — leitura com `chat:read`; `:54/79` e `:61/87` — escrita com `chat:write`; deletes permanecem `admin:write`.

### apps/realtime-service
- `authorization.ts:104-109` — `authorizeSectorScope(..., action: 'chat:read')`. Nenhum gate HTTP foi enfraquecido.

### Testes/evidência
- `apps/desk-api/src/__tests__/production/prod-04.test.ts` (novo, 18 testes; provisiona e faz teardown do run isolado).
- `docs/producao-2026-09-13/evidencias/prod-04/repro.ts` + logs e `matrix.json`.

## 3. Aceites

### AC1 — `GET /conversations` por ação + escopo deny-by-default
- Toda variante leva `requirePermission('chat:read')` antes de consultar: sem role → 403 sem conteúdo (`AC1.1`); membro lê só o próprio setor e “sem últimas mensagens” de fora (`AC1.2`); admin explícito vê todos e `?sectorId` alheio → 403 (`AC1.3`).
- Builder nunca interpreta ausência de setores como admin: `sql\`false\`` quando não há membership e `globalAdmin !== true`; `globalAdmin` só é `true` após checagem explícita na rota (`AC1.5` prova o repositório com membership revogada e com `globalAdmin: true`).
- Cursor: página continua válida e cursor adulterado → 400 (`AC1.4`); revogação entre requests reflete sem cache (`AC1.6`).
- Prova: `prod-04-final.log` (18/18) + `matrix.json` (138 probes, 0 fora do esperado).

### AC2 — matriz de ação + recurso
- Kanban board/filtros (`chat:read`) e move/assign (`chat:write`) com origem (helper do recurso) e destino (`authorizeSectorScope`) autorizados — incluindo destino alheio → 404 sem revelar (`AC2.3`).
- 18 rotas operacionais de leitura × 3 atores (sem role/papel desconhecido → 403; papel → 200) e 8 rotas de escrita × 2 atores (403 antes do efeito) no `matrix.json` (`AC2.1`/`AC2.2`).
- Contatos por vínculo (lista filtrada, detalhe alheio 404, write sem nível 403, start-conversation por setor) (`AC2.4`); tasks/alerts/notes com próprios 200 e cross-setor 404 (`AC2.5`); admin read/write por permissão (`AC2.6`); IDs adulterados 404 (`AC2.7`).
- Exceções D-AUTHZ existentes registradas: D-AUTHZ-01 (contato sem vínculo no diretório autenticado) e D-AUTHZ-02 (conversa sem setor exige vínculo/admin) continuam explícitas no código; ambas agora exigem também a permissão da ação.

### AC3 — fonte efetiva e 403/404 estáveis
- Papel concedido/removido no banco altera a decisão na requisição seguinte (`AC3.1`); membership revogada altera lista e detalhe (`AC1.6`, `AC3.4`).
- Matriz: admin, sem role, read-only (Manager sem `notes:write`; membership nível `read`), write, dois setores com níveis diferentes, recurso sem setor (dono 200 / terceiro 404 / dono sem permissão 403) e IDs inexistentes — `AC3.2`–`AC3.4`.
- Semântica preservada: `401` sem sessão; `403` sem permissão de ação ou sem nível; `404` sem membership/sem vínculo.
- Prova unitária adicional em `packages/auth`: 30/30 (`logs/auth-unit.log`).

### AC4 — WS real (subscription/entrega/revogação)
- Socket real contra `realtime-service` de verdade, `DESK_API_URL` no desk-api real, PG/Redis isolados:
  - subscription no próprio canal → `subscribed`; canal alheio → `error`;
  - revogação de membership corta o canal em **454 ms** (`subscription.revoked`);
  - revogação de sessão fecha o socket com código **4002** em **477 ms** (≤5 s);
  - após a revogação, o gate HTTP segue negando (`GET /conversations/:id/messages` → 404; `/auth/me` → 401), sem enfraquecimento para alinhar com o WS.
- Prova: `logs/ac4-ws.json` + `prod-04-final.log`.

## 4. Comandos e resultado

| # | Comando (resumo) | Exit | Log |
|---|---|---|---|
| 1 | `AAA_RUN_ID=prod04-20260913 AAA_WORKER_INDEX=10 pnpm exec tsx .../repro.ts` (antes) | 0 | `logs/repro-antes.log` |
| 2 | `pnpm --filter @cvg/auth test` (após o delta, com os testes novos) | 0 · 30 testes | `logs/auth-unit.log` |
| 3 | `DATABASE_URL=...57432... pnpm --filter @cvg/desk-api exec vitest run src/__tests__/sector-authz.integration.test.ts` | 0 · 9 testes | `logs/sector-authz-regressao.log` |
| 4 | `AAA_RUN_ID=prod04-20260913 AAA_WORKER_INDEX=10 pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-04.test.ts` | **0 · 18 testes** | `logs/prod-04-final.log` |
| 5 | `AAA_RUN_ID=prod04-20260913 ... pnpm exec tsx .../repro.ts` (depois) | 0 | `logs/repro-depois.log` |
| 6 | `pnpm exec tsx e2e/support/aaa/teardown-aaa-env.ts --stop-services --drop-database` | 0 | `logs/teardown-cli.log` |
| 7 | `pnpm --filter @cvg/desk-api typecheck` / `lint` | 0 / 0 | `logs/lint-desk-api.log` |
| 8 | Typecheck `@cvg/auth @cvg/kanban @cvg/contacts @cvg/tutors @cvg/patients @cvg/chat @cvg/realtime-service` | 0 | este relatório |
| 9 | Regressão em PG isolado: `chat-routes` (5), `contacts-routes` (14), `labels-routes` (11), `transfers-routes` (10), `contact-groups-routes` (12), `task-filters.integration` (3) | 0 | `logs/regressao-*.log` |
| 10 | Regressão: `kanban-routes.integration.test.ts` | **1 (esperado)** | `logs/regressao-kanban-routes.log` |

## 5. Riscos e limitações (honestos)

1. **`kanban-routes.integration.test.ts` antigo codifica o bypass removido**: os 2 casos usam um papel customizado sem nenhuma permissão do catálogo e esperavam `200`/`404`; com `chat:write` obrigatório agora recebem `403`. O arquivo está **fora do escopo de escrita** desta tarefa e não foi editado — precisa ser adaptado pelo dono da integração (ex.: atribuir um papel com `chat:write` ou criar `role_permissions` equivalentes) antes de DONE.
2. **D01 continua OPEN**: a fonte estática `RolePermissions` segue sendo o catálogo efetivo; `role_permissions`/`permissions` do banco não são consultados por `requirePermission`/helpers. Decisão/ação mudam com roles e memberships do banco (provado), mas ratificar o catálogo de papéis de produção segue pendente.
3. **Aliases fora do escopo**: `labels`, `transfers` e `contact-groups` (não pertencentes ao ownership) passam `contacts:read/write`; o alias foi mapeado explicitamente para `chat:read/write` e as regressões passaram, mas esses módulos ainda não têm `requirePermission` nas rotas (não alterados aqui).
4. **`authorizeSectorScope` com ação é opcional**: callers fora do escopo (transfers) não informam ação; não há regressão, porém a cobertura de “ação” nesse helper só vale onde o caller declara.
5. **WS em réplica única**: a prova de socket foi feita com um processo realtime (PG/Redis isolados). Fanout entre múltiplas réplicas e `aaa-05-isolation`/leases não foram reexecutados aqui (fronteira PROD-12/PROD-05).
6. **BE17 carga/EXPLAIN**: o delta corrige o vazamento e a semântica do builder; EXPLAIN/carga/inserção concorrente continuam NOT_RUN (fronteira PROD-33/PROD-08).
7. Testes que exigem outros runs históricos (aaa-04, aaa-11 etc.) não foram reexecutados; a regressão usou o run isolado próprio e as suítes que aceitam `DATABASE_URL`.

## 6. Rollback

- Reverter apenas este delta: `packages/auth/src/{rbac.ts,resource-authz.ts}` e os controllers/repo listados na seção 2; os testes `production/prod-04.test.ts` e `packages/auth/src/__tests__/resource-authz.test.ts` e a pasta de evidências são aditivos.
- Sem schema/migrations/dados: nada em `packages/database` foi tocado; o banco isolado foi dropado no teardown.
- Recursos externos: apenas o run `prod04-20260913-w10` (PG/Redis em `/tmp/cvg-aaa-runs/...` e evidências em `docs/producao-2026-09-13/evidencias/prod-04/`), já encerrados.

## 7. Próxima ação

Integrador: adaptar `kanban-routes.integration.test.ts` ao novo gate (ver Risco 1), decidir D01 sobre o catálogo (Risco 2) e revisar este delta antes de DONE; crítico fresco deve reproduzir os negativos e ler o `matrix.json` sem aceitar este relato como prova.

## 8. Correção pós-revisão independente (F1–F3/F5) — candidato atual

Revisão independente (contexto fresco) encontrou defeitos no par (RELATORIO,
PERMISSOES). Este delta corrige os achados sem tocar schema/migrations, sem
reset/clean/stash e sem enfraquecer asserts.

### F1 (ALTA) — revogar TODAS as permissões de um built-in não negava

- **Causa:** `actorGrantsPermission` só era autoritativo com `permissions.length
  > 0`; conjunto vazio caía no catálogo estático (`rbac.ts`).
- **Correção:**
  - `packages/auth/src/permission-service.ts:20-105` — `UserAccess` ganha
    `permissionsAuthoritative`; `isRolePermissionsProvisioned()` checa
    `EXISTS(role_permissions)` com cache curto de **5 s**
    (`resetPermissionProvisionCacheForTests` para os testes);
    `resolveUserAccess` resolve acesso + flag.
  - `packages/auth/src/rbac.ts:92-134` — `hasAuthoritativePermissions` +
    `actorGrantsPermission`: instalação provisionada é autoritativa **mesmo
    vazia** (nega built-in e Admin); estático só na instalação sem
    `role_permissions`.
  - `packages/auth/src/middleware.ts:51-76` — `authenticate` propaga
    `permissionsAuthoritative` no `request.user`.
  - `packages/auth/src/rbac-middleware.ts:13-16` — tipo do `request.user`
    (decisão já passa por `actorGrantsPermission`).
  - `packages/auth/src/authorize.ts:15-28,99-106` — override de Admin só no
    modo legado.
  - `packages/auth/src/resource-authz.ts:4-16,89-113` — idem para os helpers
    de recurso.
- **Teste HTTP:** `AC3.10` (`prod-04.test.ts`) — Manager com as 9 linhas de
  `role_permissions` removidas → `GET /conversations` e `?sectorId` → **403**
  sem conteúdo; reinserção das 9 → **200**. Unitários: `rbac-effective`,
  `authorize`, `rbac-middleware`, `resource-authz`, `permission-service`
  (60/60 em `logs/auth-unit-fix.log`).
- **Comando:** run `prod04-fix` (abaixo) — exit **0**.

### F2 (MÉDIA) — papel customizado negado em `?sectorId`

- **Causa:** `outbound.controller.ts` chamava `authorize({id, roles})` sem
  `permissions` na variante com `sectorId`.
- **Correção:** `modules/chat/src/presentation/http/outbound.controller.ts:234-248`
  passa `request.user?.permissions` e `request.user?.permissionsAuthoritative`.
  Demais chamadas de `authorize(`/helpers já recebem `request.user` inteiro
  (grep global em `modules/`+`apps/`).
- **Teste HTTP:** `AC3.9` — papel customizado com `chat:read` no banco →
  `/conversations` e `/conversations?sectorId` **200** com conteúdo do setor;
  revogado → **403** nas duas variantes.

### F3 (MÉDIA) — mutação de membro de contact-group sem permissão de ação

- **Correção:** `modules/contact-groups/src/presentation/http/contact-group.controller.ts:172-224`
  — `POST/DELETE /contact-groups/:id/members` ganham
  `requirePermission('chat:write')` **antes** do `authorizeGroup`. Ação
  canônica escolhida: `chat:write` (composição operacional de grupo; o
  `authorizeGroup` já autorizava membership de setor com `write`, não só
  admin) — documentado no código. A checagem de grupo/membership foi preservada.
- **Teste HTTP:** `AC2.9` — papel customizado + membership `write` sem
  `chat:write` no banco → **403** (antes 201); concedido → add **201** remove
  **200**; ator sem membership → **404**; revogado → **403**.

### F5 (BAIXA) — TOCTOU residual com `?sectorId`

- **Correção:** `modules/chat/src/infrastructure/repositories/conversation.repository.ts:113-140`
  — com `userId`/`globalAdmin!==true`, as memberships são relidas também
  quando há `sectorId`; setor pedido fora das memberships atuais →
  `sql\`false\``.
- **Teste HTTP/repo:** `AC1.7` — `findPage({userId, sectorId})` contém a
  conversa; membership revogada → 0 itens; `globalAdmin:true`+`sectorId`
  continua vendo; rota com membership revogada → **403**.

### F6 — evidência regenerada

- `matrix.json` — run `prod04-fix`, `cvg_aaa_prod04_fix_w20`, **175 probes**,
  **0** fora do esperado (AC1.7/AC2.9/AC3.9/AC3.10 incluídos).
- `logs/ac4-ws.json` — run `prod04-fix`: revogação de membership **453 ms**,
  sessão **478 ms**, close code **4002** (≤5 s).
- Suíte: **27/27** testes (`logs/prod-04-fix.log`); auth **60/60**
  (`logs/auth-unit-fix.log`).
- Regressão no runner isolado: **31/31** em 5 arquivos (`kanban 3`,
  `sector-authz 9`, `dynamic-permissions 2`, `contact-groups 12`,
  `chat-routes 5`) — `logs/regressao-fix.log`.

| # | Comando (runner isolado) | Exit | Resultado |
|---|---|---|---|
| 1 | `node scripts/production/run-integration-isolated.mjs --run-id prod04-fix --worker 20 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-04.test.ts` | **0** | 27/27; matrix 175 probes/0 divergentes |
| 2 | `node scripts/production/run-integration-isolated.mjs --run-id prod04-regressao-fix --worker 22 -- pnpm --filter @cvg/desk-api exec vitest run --no-file-parallelism src/__tests__/kanban-routes.integration.test.ts src/__tests__/sector-authz.integration.test.ts src/__tests__/dynamic-permissions.integration.test.ts src/__tests__/contact-groups-routes.integration.test.ts src/__tests__/chat-routes.integration.test.ts` | **0** | 31/31 |
| 3 | `pnpm --filter @cvg/auth test` | **0** | 60/60 |
| 4 | `pnpm --filter @cvg/auth typecheck` · `@cvg/events` · `@cvg/desk-api` · `@cvg/chat` · `@cvg/contact-groups` · `@cvg/realtime-service` | **0** | `tsc --noEmit` limpo |
| 5 | `pnpm --filter @cvg/auth lint` · `@cvg/events` · `@cvg/chat` · `@cvg/contact-groups` · `@cvg/desk-api` | **0** | sem erros (warnings pré-existentes dentro do teto) |

### Limitações restantes (após F1–F5)

1. **WS/realtime não recebe `permissionsAuthoritative`** (fora do escopo de
   escrita): `apps/realtime-service/src/authorization.ts:45,102,128` passa
   `permissions` e, com conjunto vazio, mantém o fallback estático; uma
   revogação total de `role_permissions` reflete no HTTP mas não no gate de
   subscription do WS. Membership/sessão continuam cortando conteúdo.
2. **D01 continua OPEN** (catálogo de produção não ratificado).
3. `kanban-routes.integration.test.ts` foi adaptado pelo dono e passa (3/3);
   as exceções D-AUTHZ-01/02 permanecem explícitas.
4. Alias `contacts:*` nos módulos labels/transfers/contact-groups segue como
   no delta original; sem enfraquecimento de gate.

### Rollback (delta F1–F5)

- Reverter somente os arquivos desta seção (auth: `permission-service.ts`,
  `rbac.ts`, `middleware.ts`, `rbac-middleware.ts`, `authorize.ts`,
  `resource-authz.ts`; `outbound.controller.ts`;
  `contact-group.controller.ts`; `conversation.repository.ts`; testes e
  evidências são aditivos).
- Nada de schema/migrations; runs `prod04-fix`/`prod04-regressao-fix` já
  derrubados pelo runner (teardown próprio do teste; nenhum banco do host).
