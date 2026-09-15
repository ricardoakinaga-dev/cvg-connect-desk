# AUTORIZACAO-MATRIZ — SA-013 (B03/B12/B14/B19, gates G02/G12)

**Candidato:** HEAD `754f9bad…` + worktree (manifesto corrente de `evidencias/SA-002/candidate-manifest-r3.json`) · **Contrato:** C-1 (`CONTRATOS.md` C02/C04) · **Data:** 15/09/2026.
**Escopo desta matriz:** modelo vigente de autorização por ação + recurso/setor em HTTP e WS, visão gerencial global/seletiva vigente e janelas de cache/revogação.
**Estado da decisão D01:** **OPEN**. Esta matriz **descreve o comportamento vigente** para permitir prova e revisão; ela **não ratifica** a política gerencial/diretórios nem o catálogo de produção, e nada aqui pode ser lido como autorização de D01.

Provas executáveis: `apps/desk-api/src/__tests__/sa-013-authz-matrix.integration.test.ts` (HTTP, PostgreSQL real do run isolado) e `apps/realtime-service/src/__tests__/sa-013-ws-authz.test.ts` (WS, porta de autorização real `createDatabaseAuthorizationPort`). Evidência: `evidencias/SA-013/evidence.jsonl`.

---

## 1. Modelo de decisão (ordem fixa)

O servidor é a autoridade. A UI esconder botão/rota **nunca** é a decisão; toda negativa é recalculada no servidor a cada requisição/entrega.

1. **Autenticação (401).** Sem sessão opaca válida/ativa → `401 UNAUTHORIZED`. `packages/auth/src/middleware.ts:25`; `packages/auth/src/resource-authz.ts:51`.
2. **Ação (403).** Sem a permissão da ação efetiva → `403 FORBIDDEN`, **antes** de resolver o recurso (não revela existência). `packages/auth/src/rbac-middleware.ts:23` (nega em `:54`); `packages/auth/src/resource-authz.ts:134`.
3. **Existência/escopo (404).** Recurso inexistente **ou** fora do escopo do ator (sem membership no setor) → `404 NOT_FOUND` com a mesma mensagem do inexistente. `packages/auth/src/resource-authz.ts:138`, `:155`; `apps/realtime-service/src/authorization.ts:87`.
4. **Nível (403).** Tem leitura no setor, mas não o nível da ação (`write`/`admin`) → `403 FORBIDDEN`. `packages/auth/src/resource-authz.ts:159`.
5. **Permitido.**

**Fonte de permissões (D01/PROD-04-AC3).** A fonte autoritativa é o banco: `user_roles → role_permissions → permissions` (`packages/auth/src/permission-service.ts:90`). Se a instalação tem linhas em `role_permissions` (migração 0025/seed), o conjunto resolvido — **mesmo vazio** — é autoritativo e o catálogo estático (`rbac.ts`) não é consultado; papel customizado sem linhas é negado (`packages/auth/src/rbac.ts:109`, `:126`). O catálogo estático é apenas fallback de instalação legada e nunca concede além dele. O conjunto é resolvido **por requisição** (`packages/auth/src/middleware.ts:55`), então revogação de papel/permissão vale já na requisição seguinte.

**Override global.** `Admin` (role no banco) recebe escopo global de recurso (`resource-authz.ts:143`, `:202`, `:267`, `:320`) e `requireSectorAccess` (`rbac-middleware.ts:112`), **depois** de passar pela permissão de ação efetiva. A ausência de memberships **nunca** é interpretada como admin (`apps/.../outbound.controller.ts:233`).

---

## 2. Matriz papel × ação (catálogo vigente)

`r` = read, `w` = write. `*:delete` e `admin:write` não constam da tabela por serem exclusivos de Admin no catálogo vigente. Fonte estática: `packages/auth/src/rbac.ts:41`; fonte de banco equivalente: migração `0025_role_permissions_backfill.sql` / `packages/database/src/seed.ts:72`. Onde as duas divergem, **vale a do banco** (§1).

| Ação (permissão) | Admin | Receptionist | Veterinarian | Manager | Papel customizado |
|---|---|---|---|---|---|
| chat:read | r | r | r | r | só se em `role_permissions` |
| chat:write | w | w | w | w | só se em `role_permissions` |
| chat:delete | w | — | — | — | só se em `role_permissions` |
| tasks:read | r | r | r | r | só se em `role_permissions` |
| tasks:write | w | w | w | w | só se em `role_permissions` |
| tasks:delete | w | — | — | — | só se em `role_permissions` |
| notes:read | r | r | r | r | só se em `role_permissions` |
| notes:write | w | w | w | **—** | só se em `role_permissions` |
| notes:delete | w | — | — | — | só se em `role_permissions` |
| alerts:read | r | r | r | r | só se em `role_permissions` |
| alerts:write | w | **—** | w | w | só se em `role_permissions` |
| alerts:delete | w | — | — | — | só se em `role_permissions` |
| admin:read | r | — | — | r | só se em `role_permissions` |
| admin:write | w | — | — | **—** | só se em `role_permissions` |
| dashboard:read | r | r | r | r | só se em `role_permissions` |

Negativas executadas: papel customizado sem permissão → 403 (`sa-013-authz-matrix` caso 2); revogação da permissão em sessão ativa → 403 na requisição seguinte (caso 3); Manager sem `notes:write`, Veterinarian sem `admin:read`, Receptionist sem `alerts:write` (caso 4).

## 3. Matriz ação × recurso (o que a ação exige além da permissão)

A permissão de ação é resolvida por `permissionForAction` (`packages/auth/src/resource-authz.ts:79`); ações fora do catálogo mas com equivalente explícito são mapeadas (`kanban:*`/`contacts:*` → `chat:*`, `:72`). Ação sem mapeamento é negada (default-deny).

| Recurso / rota | Permissão da ação | Escopo avaliado | Negativa de escopo |
|---|---|---|---|
| Conversa — ler mensagens | `chat:read` | membership `read` no setor da conversa | 404 "Conversation not found" |
| Conversa — ler marcações (`/read`) | `chat:read` | idem | 404 |
| Conversa — enviar (`/messages` POST) | `chat:write` | membership `write` | 404 sem leitura / 403 sem nível |
| Conversa — estado/atribuição/handoff | `chat:write` | membership `write` | 404/403 |
| Lista `/conversations` (sem filtro) | `chat:read` | filtrada por memberships no repositório; sem setores ⇒ lista vazia | sem revelação (vazio honesto) |
| Lista `/conversations?sectorId=` | `chat:read` | membership no setor pedido | 403 "No access to this sector" (`outbound.controller.ts:252`) |
| Task com conversa | `tasks:*` | delega à conversa | 404/403 da conversa |
| Task sem conversa | `tasks:*` | criador, assignee ou admin global | 404 |
| Nota com conversa/task | `notes:*` | delega à conversa/task | 404/403 |
| Nota sem vínculo | `notes:read` | autor ou admin global | 404 |
| `mine=true` (notas) | `notes:read` | apenas `authorId = ator`; não equivale a feed global (`note.controller.ts:282`) | — |
| Alerta com conversa/task | `alerts:*` | delega à conversa/task | 404/403 |
| Alerta sem vínculo | `alerts:read` | `triggeredBy`/`acknowledgedBy`/`resolvedBy`, donos da task ou admin | 404 |
| Contato com vínculos de setor | `chat:read`/`write` | membership `read` em ≥1 setor vinculado | 404 sem vínculo; 403 só com leitura e sem escrita |
| Contato **sem** vínculo | `chat:read` | diretório autenticado (política vigente — §5) | — |
| Setor explícito (iniciar conversa/mover Kanban) | ação de origem (`chat:write`) | membership `write` | 404 sem leitura / 403 sem nível |
| Fila/task no Kanban | `chat:read`/`chat:write` | conversa/setor do card | 404/403 |

## 4. Matriz setor (membership)

`user_sectors.access_level` ∈ `read` < `write` < `admin` (`packages/auth/src/sector-permissions.ts:46`). Regra de ação: `:read` exige `read`; qualquer outra exige `write` (`resource-authz.ts:63`).

| Situação do ator | Conversa do setor A | Conversa do setor B | Conversa sem setor | Observação |
|---|---|---|---|---|
| Sem membership em A nem B | 404 | 404 | 404 | default-deny, sem revelar existência |
| Membership `read` em A | permitido p/ leitura; escrita 403 | 404 | 404 | — |
| Membership `write` em A | permitido p/ leitura e escrita | 404 | 404 | — |
| Assignee da conversa sem setor | — | — | permitido (§4.1) | vínculo explícito |
| Role `Admin` (ou admin global no banco) | permitido | permitido | permitido | override após permissão de ação |

### 4.1 Recursos órfãos (sem setor / sem vínculo)
- Conversa `sectorId IS NULL`: somente `assignedUserId = ator` ou admin global (`resource-authz.ts:168`; contrato D-C02-3; prova em `aaa-05-isolation.test.ts` e no caso 5 do teste SA-013).
- Task sem conversa: `createdBy`/`assignedTo` ou admin.
- Alerta sem vínculo: donos/triggers ou admin.
- Nota sem conversa/task: autor ou admin (`note.controller.ts:325`).
- **Política de contatos sem vínculo** (diretório): contatos sem nenhum setor permanecem visíveis a qualquer autenticado com `chat:read` (`contact.controller.ts:59` — `D-AUTHZ-01`). Isto é política vigente, **não ratificada**; ver §8 (D01).

## 5. Visão gerencial global/seletiva (contrato explícito — C02/B14)

**Comportamento vigente:** todas as rotas `/metrics/*` exigem apenas `dashboard:read` e **não aplicam filtro de setor** — os agregados são globais para qualquer papel que tenha a permissão (`modules/dashboard/src/presentation/http/dashboard.controller.ts:22`). A leitura é seletiva apenas no sentido de que o **conjunto de papéis** com `dashboard:read` é decidido pelo catálogo do banco.

**Campos que podem sair por aging** (`GET /metrics/aging`, `modules/dashboard/src/infrastructure/dashboard.repository.ts:354`; tipos em `modules/dashboard/src/types/index.ts:96`):
`conversationId`, `status` (`open|pending`), `sectorName`, `lastMessageAt` (ISO), `hoursSinceLastMessage` (número, 1 casa), `agingBucket` (`fresh|normal|old|critical`). Limite 1–100 (`dashboard.controller.ts:62`). **Não** saem: conteúdo de mensagem, telefone/nome de contato, participantes, IDs de contato.

**Campos que podem sair por diretório** (`GET /contacts`, `contact.controller.ts:84`): linha de contato do repositório (nome, telefone, e-mail, vínculos) — incluindo contatos **sem** vínculo de setor, visíveis a qualquer autenticado com `chat:read`. Contatos vinculados só saem se o ator tem `read` em ≥1 setor vinculado (`contact.controller.ts:64`). O detalhe (`GET /contacts/:id`) aplica a mesma autorização e **filtra as conversas do detalhe** por recurso (`contact.controller.ts:153`).

**Campos de setor** (`GET /metrics/sector-backlog`, `dashboard.repository.ts:324`): `sectorId`, `sectorName`, contagens `open`/`pending`/`totalBacklog`.

**Sem bypass.** Não existe parâmetro de cliente que force visão global (o único parâmetro de aging é `limit`); "sem setores" não vira admin (§1); a projeção de aging não inclui conteúdo. **Qualquer alteração desta política** (ex.: tornar gerencial por escopo de setor, restringir contatos sem vínculo, ratificar o catálogo de produção) **exige D01** e não é executada por esta tarefa.

## 6. Enforcement points (file:line, candidato atual)

| Ponto | Arquivo:linha |
|---|---|
| Autenticação por requisição + resolução de acesso do banco | `packages/auth/src/middleware.ts:25` (acesso em `:55`) |
| Provisionamento autoritativo (TTL 5s do flag) | `packages/auth/src/permission-service.ts:57`, `:73` |
| Decisão de permissão efetiva | `packages/auth/src/rbac.ts:109`, `:126` |
| `requirePermission` (403) | `packages/auth/src/rbac-middleware.ts:23`, negação `:54` |
| `requireRole` (403) | `packages/auth/src/rbac-middleware.ts:62` |
| `requireSectorAccess` (400 sem setor/403 sem membership) | `packages/auth/src/rbac-middleware.ts:92`, `:128` |
| Conversa (401/403/404) | `packages/auth/src/resource-authz.ts:119` (negações `:51/:55/:59`) |
| Contato | `packages/auth/src/resource-authz.ts:180` |
| Task | `packages/auth/src/resource-authz.ts:237` |
| Alerta | `packages/auth/src/resource-authz.ts:288` |
| Escopo de setor explícito | `packages/auth/src/resource-authz.ts:346` |
| Conversa por rota HTTP (mensagens) | `modules/chat/src/presentation/http/outbound.controller.ts:145` |
| Lista com escopo explícito (403) | `modules/chat/src/presentation/http/outbound.controller.ts:238`, `:252` |
| Contexto task (404 sem vazar) | `modules/tasks/src/presentation/http/task.controller.ts:218`, `:239` |
| Contexto nota (404 sem vazar) | `modules/notes/src/presentation/http/note.controller.ts:264` |
| Contexto alerta (404 sem vazar) | `modules/alerts/src/presentation/http/alert.controller.ts:124` |
| Diretório de contatos (política vigente) | `modules/contacts/src/presentation/http/contact.controller.ts:59` |
| Dashboard (global vigente, D01 OPEN) | `modules/dashboard/src/presentation/http/dashboard.controller.ts:22` |
| Janelas de aging diretório/gerencial | `modules/dashboard/src/infrastructure/dashboard.repository.ts:354`, `:324` |
| WS — cache de permissão 1s | `apps/realtime-service/src/authorization.ts:37`, `:40` |
| WS — permissão antes do recurso; UUID inválido não consulta banco | `apps/realtime-service/src/authorization.ts:82`, `:87` |
| WS — subscribe/entrega | `apps/realtime-service/src/authorization.ts:158`, `:162` |
| WS — deadline de revogação 5s / revalidação 2s | `apps/realtime-service/src/index.ts:55`, `:59`, `:60` |
| WS — sweep + revogação de canal | `apps/realtime-service/src/index.ts:895`, `:868` |
| WS — entrega por destinatário (fail-closed) | `apps/realtime-service/src/index.ts:1054` |
| WS — revogação de sessão fecha 4002 | `apps/realtime-service/src/index.ts:770` |

## 7. Negativos: semântica de status (sem revelar existência)

| Status | Corpo | Quando | Não revela |
|---|---|---|---|
| 400 `BAD_REQUEST` | `{error,message}` | escopo de setor obrigatório ausente na rota (`rbac-middleware.ts:105`); entrada inválida | não distingue recursos |
| 401 `UNAUTHORIZED` | `{error:'UNAUTHORIZED',message}` | sem/!sessão inválida, sessão expirada/revogada | não distingue recursos |
| 403 `FORBIDDEN` | `{error:'FORBIDDEN',message}` | sem permissão de ação; ou nível de setor insuficiente; ou escopo explícito de setor alheio | não distingue existência: para recurso existente fora de escopo a resposta é **404** |
| 404 `NOT_FOUND` | `{error:'NOT_FOUND',message}` | recurso inexistente **ou** sem membership/leitura no escopo; corpo idêntico ao inexistente | existência, setor, dono |

Ordem estável e não ambígua: **401 antes de ação; 403 de ação antes da resolução do recurso; 404 de escopo antes de 403 de nível** (exceto nível, que pressupõe leitura). Provado no teste HTTP SA-013: o corpo 404 de "conversa real do setor B" é **igual** ao de "UUID inexistente" na rota de mensagens e no contexto de tasks; o corpo 403 de "papel sem permissão" é igual para conversa existente e UUID inexistente.

**WebSocket.** Não há 404 no socket: subscribe negado vira `event:error`/`subscribe.error` com mensagem genérica `Channel not authorized` (mesma para canal existente-e-proibido e inexistente); revogação de sessão/`Principal changed` fecha `4002`; falha de autenticação fecha `4003`; entrega negada nunca envia o evento e emite `subscription.revoked` (`index.ts:868`, `:989`, `:770`). Canais `user:<id>` só são autorizados ao próprio usuário (`authorization.ts:147`).

## 8. Janelas de cache e revogação (AC3)

| Superfície | Mecanismo | Janela | Onde |
|---|---|---|---|
| HTTP (API) | permissões resolvidas do banco **por requisição**; flag de provisionamento cacheada | próxima requisição (flag ≤5s, mas o flag não cacheia permissões) | `middleware.ts:55`; `permission-service.ts:57` |
| WS — permissões efetivas (DB) | cache por usuário `ACCESS_CACHE_TTL_MS` | **1s** | `apps/realtime-service/src/authorization.ts:37` |
| WS — revalidação de sessão/token | timer por conexão | **≤2s** (`DEFAULT_REVALIDATE_MS=2000`, clampeado pelo deadline) | `apps/realtime-service/src/index.ts:59`, `:680` |
| WS — decisão por canal | cache por canal | `DEFAULT_AUTHZ_CACHE_MS=2000`, clampeado a `5000 − 2×authFetchTimeout` | `apps/realtime-service/src/index.ts:60`, `:844` |
| WS — revogação total (permissão/membership/sessão) | sweep pós-revalidação + `deliverToTarget` fail-closed | **≤5s** (`AUTH_DEADLINE_MS=5000`) | `index.ts:55`, `:895`, `:1054` |

A negação transitória (`authorization-timeout`, `session-unavailable`) **não** revoga canal definitivamente; apenas bloqueia a entrega e reavalia no próximo ciclo (`index.ts:1067`, `:1085`). Revogação definitiva emite `subscription.revoked`.

## 9. D01 — itens abertos e o que permanece bloqueado

| Item | Estado | Bloqueia |
|---|---|---|
| Ratificar catálogo por papel (produção) | **OPEN (D01)** | Fechar B03/B04 ≥95 e mudanças de política de papéis |
| Ratificar política de visão gerencial global/seletiva (dashboard) | **OPEN (D01)** | Alterar escopo dos `/metrics/*`; projeções gerenciais novas |
| Ratificar política de diretórios (contato sem vínculo visível a autenticado) | **OPEN (D01)** | Restringir/expandir diretório; `D-AUTHZ-01` |
| Aplicação de política global nova | **BLOQUEADO até D01** | SA-044 (aplicação nova), projeções gerenciais de SA-022/046 |

Esta matriz documenta o **vigente** e prova os invariantes de isolamento/negativa; ela não decide D01. Nenhuma mudança de política foi aplicada por SA-013.

## 10. Matriz machine-readable

```json
{
  "contract": "C-1",
  "task": "SA-013",
  "candidate": "754f9bad+worktree",
  "decision_source": "database role_permissions (authoritative); static catalog only for legacy provisioning",
  "decision_order": ["401_auth", "403_action_permission", "404_existence_or_scope", "403_scope_level", "allow"],
  "roles": {
    "Admin": ["chat:read","chat:write","chat:delete","tasks:read","tasks:write","tasks:delete","notes:read","notes:write","notes:delete","alerts:read","alerts:write","alerts:delete","admin:read","admin:write","dashboard:read"],
    "Receptionist": ["chat:read","chat:write","tasks:read","tasks:write","notes:read","notes:write","alerts:read","dashboard:read"],
    "Veterinarian": ["chat:read","chat:write","tasks:read","tasks:write","notes:read","notes:write","alerts:read","alerts:write","dashboard:read"],
    "Manager": ["chat:read","chat:write","tasks:read","tasks:write","notes:read","alerts:read","alerts:write","admin:read","dashboard:read"],
    "custom": ["exactly the rows of role_permissions for that role; empty = deny all, including Admin-named absence of rows is NOT an override in authoritative installs"]
  },
  "resource_rules": [
    {"resource":"conversation","action":"chat:read","scope":"membership read on sector; assigned user for sectorless; admin override","denial":"404 without read membership; 403 without required level"},
    {"resource":"conversation","action":"chat:write","scope":"membership write","denial":"404/403"},
    {"resource":"task","action":"tasks:*","scope":"delegate to conversation else creator/assignee/admin","denial":"404"},
    {"resource":"note","action":"notes:*","scope":"delegate to conversation/task else author/admin","denial":"404"},
    {"resource":"alert","action":"alerts:*","scope":"delegate to conversation/task else owners/admin","denial":"404"},
    {"resource":"contact","action":"chat:*","scope":"any linked sector membership; sectorless stays in authenticated directory (current policy, D01 OPEN)","denial":"404 no link, 403 read-but-not-write"},
    {"resource":"sector","action":"explicit scope","scope":"membership write","denial":"404 no read, 403 no write"},
    {"resource":"dashboard","action":"dashboard:read","scope":"global aggregates (current policy, D01 OPEN)","denial":"403 without permission"}
  ],
  "denials": {"401":"UNAUTHORIZED {error,message}","403_action":"FORBIDDEN missing permission (resource existence not evaluated)","403_scope":"FORBIDDEN insufficient sector level (read is known)","404":"NOT_FOUND identical to nonexistent for foreign/orphan resources"},
  "ws": {"subscribe_denied":"error/subscribe.error generic 'Channel not authorized'","delivery_denied":"no event + subscription.revoked","session_revoked":"close 4002","auth_failed":"close 4003"},
  "windows_ms": {"api_resolution":"per-request","ws_permission_cache":1000,"ws_revalidation":2000,"ws_revocation_max":5000},
  "management_visibility": {"aging_fields":["conversationId","status","sectorName","lastMessageAt","hoursSinceLastMessage","agingBucket"],"directory_fields":"contact row incl. sectorless contacts (D01 OPEN)","sector_backlog_fields":["sectorId","sectorName","openConversations","pendingConversations","totalBacklog"],"policy_change":"requires D01", "client_bypass":"none"},
  "d01_open": ["ratify production role catalog","ratify global/selective management visibility","ratify directory policy for sectorless contacts"]
}
```

## 11. Limitações desta matriz

- Não existe dimensão de tenant/organização no schema vigente: a fronteira de isolamento de dados é o **setor** + a instância/banco isolado por run. O caso "cross-tenant" do aceite foi executado como cruzamento de escopo (setor A → recurso de B) e como verificação de que o teste fala com o banco da URL do run (`current_database()`), sem afirmação de multi-tenant inexistente.
- A matriz de papéis reflete o catálogo **vigente** (código/migração). Divergência entre catálogo estático e banco tem o banco como vencedor; o catálogo de produção é D01.
- Campos de aging/diretório foram levantados do código e do repositório no candidato; não houve ratificação de produto (D01).


## Atualização do lead (onda R2) — correção do achado G02

O detalhe de **task, nota, alerta e contato** negado por escopo passou a responder corpo **idêntico** ao de um recurso inexistente (antes: `Conversation not found`/`Contact not found` vs `Task not found`/`Note not found`/`Alert not found`/`Contato`, o que revelava existência). Regressão executável: casos 7 e 8 de `apps/desk-api/src/__tests__/sa-013-authz-matrix.integration.test.ts` (8/8) no run `sa013-oracles` (`evidencias/SA-013/runs/sa013-oracles/`). Permanecem uniformes (verificados por leitura): `GET /conversations/:id/*` e chat (mesma mensagem para negado/inexistente), grupos (`Grupo não encontrado`), transferências (`Transferência não encontrada`). A allowlist de mutações sem schema (logout/rotate/logout-all e webhook do gateway autenticado por assinatura) é validada pelo teste de fronteira de SA-011.


## Lacunas de escopo declaradas (correção pós-crítica)

| Superfície | Regra vigente | Situação |
|---|---|---|
| `GET/PUT/DELETE /patients/:id` e `/tutors/:id` | Exigem apenas a permissão de ação (`chat:read`/`chat:write`) e vínculo quando o recurso tem setor; NÃO há escopo por setor para pacientes/tutores nesta entrega | **D01 OPEN** — política setorial para cadastros clínicos precisa de decisão; a matriz não inventa bypass. Fica registrado como lacuna de cobertura, não como conformidade. |
| Catálogo `/labels` (`GET /labels`, `PUT/DELETE /labels/:id`) | Permissão de ação + vínculo do contato/conversa associado; o catálogo em si é global do tenant | Documentado; aguarda D01 para regra seletiva. |
| Sub-rotas `/contacts/:id/{groups,labels,transfers}` | Contato inexistente e contato negado retornam o MESMO 404 `Contact not found` (caso 8) | Corrigido e coberto. |
