# PROD-18 — Relatório de execução (APIs operacionais transacionais e trilha de auditoria)

**Tarefa:** PROD-18 (AC1–AC4) · **Itens auditados:** UI05, UI06, UI08, UI10, BE04, BE05, BE11
**Contratos:** C07 (G06) · **Data:** 2026-09-13 · **Executor:** agente backend operação
**Candidato:** `754f9badac46278e77d21de91c58eedb15e80581` + worktree (delta **não commitado**; worktree compartilhada com
frentes preexistentes de PROD-04/08/09/10/11/16)
**Estado do cartão:** **IMPLEMENTED / aguardando revisão do integrador — não declarado DONE**
**Ambiente de prova:** PostgreSQL + Redis isolados do harness AAA (`cvg_aaa_prod18_w42`, 127.0.0.1:60632/57100;
marcador `cvg_aaa_*` conferido). Nunca o banco do host. Teardown por runId (`stopServices+dropDatabase`) ao final de
cada run. Fronteiras respeitadas: **nenhuma** edição em `packages/auth`, `packages/media`, `modules/privacy`,
`schema/migrations`, `realtime/events`, `conversation.repository.ts` ou `outbound-atomic.repository.ts`.

| Run | Worker | PostgreSQL | Banco | Exit |
|---|---|---:|---|---:|
| `prod18-repro` (repro antes) | 42 | 127.0.0.1:60632 | `cvg_aaa_prod18_repro_w42` | 0 (veredito DEFECT_REPRODUCED) |
| `prod18` (suíte AC, 2ª rodada final) | 42 | 127.0.0.1:60632 | `cvg_aaa_prod18_w42` | **0 · 18/18** |
| `prod18-regressao-modulos` | 43 | 127.0.0.1:60732 | `cvg_aaa_prod18_regressao_modulos_w43` | **0 · 66/66** |
| `prod18-regressao-app` | 44 | 127.0.0.1:60832 | `cvg_aaa_prod18_regressao_app_w44` | **0 · 24/24** |
| `prod18-regressao-aaa` | 46 | 127.0.0.1:61032 | `cvg_aaa_prod18_regressao_aaa_w46` | 1 (guarda de ambiente histórica; ver §6.9) |

---

## 1. Problema reproduzido antes do delta

`logs/repro-antes.ts` executado contra o candidato ANTES das edições, com PG real e falhas injetadas por trigger
(`logs/repro-antes.json`, `logs/repro-antes-runner.log`, `integration-runs/prod18-repro/runner-summary.json`).
Veredito: **`DEFECT_REPRODUCED`**.

| # | Cenário | Resultado antes (PG real) | Defeito |
|---|---|---|---|
| A | `createNote` com falha na auditoria | nota persistida=1, auditoria=0, outbox=0, `isErr=true` | escrita parcial: nota commitada sem trilha |
| B | `updateTaskStatus` com falha na auditoria | status=`completed`, histórico=1, auditoria=0, outbox=0 | status mudado sem trilha |
| C | `acknowledgeAlert` com falha na auditoria | status=`acknowledged`, alert_events=1, auditoria=0, outbox=0 | alerta reconhecido sem trilha |
| D | `createTransfer(autoAccept)` com falha no vínculo | transferência=`accepted`, conversa movida p/ B, vínculo=1 (origem órfã), auditoria=0, outbox=0 | estado contraditório (transferência+conversa vs. contato) |
| E | operação pública de estado/atribuição/handoff | rotas inexistentes no módulo chat (UI05) | API operacional incompleta |

---

## 2. Delta (arquivos do delta PROD-18)

### 2.1 Núcleo transacional e auditoria

| Arquivo | Mudança |
|---|---|
| `modules/*/src/infrastructure/audit.ts` (notes/tasks/alerts/transfers, novos) | `insertOperationalAudit(tx, entry)`: insert de `audit_logs` no MESMO executor da entidade/histórico/outbox, sem PII (estados/referências/tamanhos). |
| `modules/chat/src/application/audit.ts` (novo) | idem no módulo chat (escopo permitido: `application/**`). |
| `modules/audit/src/infrastructure/repositories/audit.repository.ts` | filtro `correlationId`; ordem total `createdAt desc, id desc`; período converte instante UTC para o wall time do fuso da sessão (`AT TIME ZONE current_setting('TimeZone')`) por `audit_logs.created_at` ser TIMESTAMP sem fuso (DT01). |
| `modules/audit/src/presentation/http/audit.controller.ts` | filtro por correlação; limites/bounds; data inválida → `400 INVALID_START_DATE/INVALID_END_DATE` (nunca 500). |

### 2.2 Operações transacionais

| Módulo | Mudança |
|---|---|
| notes | `createNote` em `db.transaction`: nota + auditoria + outbox `note.created`; versão tx do repositório; lista com `limit/offset` e ordem total. |
| tasks | `createTask`/`updateTaskStatus` transacionais (tarefa + histórico + auditoria + outbox `task.created`/`task.status.changed`); CAS `updateStatusIfCurrent`; mapa de transições; repetição idempotente; `createdBy`/`changedBy` da sessão. |
| alerts | `createAlert` (2º caminho e idempotente) + `acknowledge`/`resolve` transacionais com CAS (`acknowledgeIfActive`/`resolveIfNotResolved`), auditoria e outbox; autor derivado da sessão; lista com filtros AND reais + `limit/offset`. |
| transfers | `createTransfer`/`acceptTransfer`/`rejectTransfer` atômicos (transferência + conversa + vínculos + auditoria + outbox) serializados por `pg_advisory_xact_lock` do contato; revalidam origem dentro do lock; `fromSector`/destino/recipiente validados; dedup de pedido repetido; CAS no aceite/rejeição; `POST /transfers` agora exige `chat:write`; listas com `limit/offset` e ordem total. |
| chat | **novo** `conversation-operations.use-case.ts`: `changeConversationState`, `assignConversation`, `handoffConversation` — `SELECT ... FOR UPDATE`, transições documentadas, CAS (`expectedStatusV2`/`expectedAssignedUserId`/`expectedHandler`/`expectedUpdatedAt`), idempotência, auditoria e outbox (`conversation.status.changed`, `conversation.assigned`, `handoff.requested`+`handoff.completed`) na mesma transação; **novo** `conversation-operations.controller.ts` com `PATCH /conversations/:id/state`, `POST /conversations/:id/assign`, `POST /conversations/:id/handoff`, registrado pelo `registerOutboundController` (sem tocar `app.ts`). |
| admin | auditoria (`createAuditLog`) em users/roles/queues/teams (criar/atualizar/excluir) com ator da sessão, antes/depois sem hash de senha e correlação; setores/DLQ passam a gravar correlação. |

### 2.3 Testes/evidência

| Arquivo | Mudança |
|---|---|
| `apps/desk-api/src/__tests__/production/prod-18.test.ts` (novo, 1286 linhas) | 18 testes HTTP+PG reais (AC1–AC4) com triggers de falha, concorrência e matriz de auditoria. |
| `apps/desk-api/src/__tests__/transfers-routes.integration.test.ts` | repetição de aceite/rejeite deixou de ser 400 e virou 200 `deduplicated:true`; cleanup remove a trilha antes do usuário (FK). |
| `modules/notes/src/__tests__/create-note-author.test.ts`, `modules/transfers/src/__tests__/use-cases.test.ts`, `modules/alerts/src/__tests__/repository-structure.test.ts` | ajustados ao contrato transacional/CAS. |
| `docs/producao-2026-09-13/evidencias/prod-18/**` | repro antes, logs, `evidence-matrix.json` + este relatório. |
| `modules/{notes,tasks,alerts,transfers}/package.json` | dependência `@cvg/events` (workspace) para o outbox transacional. |

Nenhum `TODO`, `skip` ou `.only` foi introduzido no delta.

---

## 3. Aceites

### AC1 — Operações transacionais (entidade + histórico + auditoria + outbox no MESMO `tx`)

Evidência: `logs/prod-18-final.log` (18/18, exit 0); `evidence-matrix.json` (`missingAudit: []`, `missingOutbox: []`).

- **Nota**: trigger em `audit_logs` faz o `POST /notes` responder **500**; contagem de notas=0, auditoria=0, outbox=0
  (rollback total). Removido o trigger, o `201` grava as quatro escritas com a MESMA correlação.
- **Tarefa**: trigger em `outbox_events` (`task.status.changed`) faz o `PATCH` responder **500**; status permanece
  `pending`, histórico=1 (só criação), auditoria=0, outbox=0. Sucesso grava status + histórico + auditoria
  (`old_value/new_value` reais) + outbox.
- **Alerta**: trigger na auditoria faz o `ack` responder **500** com alerta ainda `active`; sucesso grava alerta +
  `alert_events` + auditoria + outbox; `ack` repetido é idempotente (sem novas linhas).
- **Transferência**: trigger em `contact_sectors` faz o `POST /transfers` responder **500**; transferências=0,
  conversa ainda no setor A e vínculo A ativo — nenhum estado parcial. Sucesso aplica transferência + conversa +
  vínculos + auditoria + outbox e move o vínculo (A→transferred, B→active).
- **Conversa**: falha na auditoria de `assign`/`handoff` responde **500** sem atribuição/handler e sem outbox; sucesso
  grava estado + histórico/assignment + auditoria + outbox. `handoff` grava `handoff.requested` E
  `handoff.completed` na MESMA transação; repetição é idempotente.
- **Eventos só após commit**: a intenção (`persistOutboxEventIntent(tx, …)`) participa do `tx`; o hint realtime
  (`publishRealtimeHintsAfterCommit`) é chamado depois do commit — se o Redis falhar, o polling do outbox permanece
  o caminho durável (mesmo contrato D-C03-2 provado no PROD-08).

### AC2 — Trilha de auditoria real e consulta

- Toda ação da matriz grava `audit_logs` com **ator = principal da sessão** (`userId`), recurso (`entity_type`/
  `entity_id`), antes/depois (estados, nunca conteúdo/PII — a trilha de nota grava `contentLength`, não o texto),
  correlação (`x-correlation-id` ou request id) e metadados de causa.
- `GET /audit/logs` filtra por `userId` (ator), `entityType`+`entityId` (recurso), `action`, `correlationId` e
  período (`startDate`/`endDate`); data inválida → 400; sem `admin:read` → 403; ordem total e `limit/offset`.
- Autores não falsificáveis: `authorId`/`acknowledgedBy`/`changedBy` divergentes da sessão → **400 sem efeito**.
- Matriz completa em `evidence-matrix.json` (12 ações exercitadas por HTTP, todas com ≥1 linha de auditoria do ator)
  e resumida em §4. **Nenhuma linha de auditoria sem tx** nas ações operacionais (o insert usa o mesmo `tx`).

### AC3 — Autorização por ação+recurso, 409 e idempotência

- `401` sem sessão em todas as rotas; `403` sem permissão de ação (papel customizado sem permissões ou papel
  operacional negado); `404` sem vínculo de setor (sem revelar o recurso) — inclusive no destino de transferência.
- **Revogação da fonte efetiva**: removido `notes:write` de um papel customizado no banco, a requisição seguinte
  responde **403** e não grava; reintroduzida a permissão, **201**. (Fonte autoritativa do PROD-04.)
- CAS/versão: estado com `expectedStatusV2`/`expectedUpdatedAt` defasado → **409** `CONVERSATION_STATUS_CONFLICT`/
  `CONVERSATION_VERSION_CONFLICT`; transição fora do mapa → **409** `INVALID_STATUS_TRANSITION`; tarefa com
  `expectedStatus` defasado ou transição inválida → **409** `TASK_STATUS_CONFLICT`/`INVALID_TASK_STATUS_TRANSITION`;
  alerta resolvido → **409** `ALERT_STATE_CONFLICT`; transferência com origem defasada → **409**
  `TRANSFER_SECTOR_MISMATCH`, aceite de rejeitada → **409** `TRANSFER_STATE_CONFLICT`; handoff com handler esperado
  divergente → **409** `CONVERSATION_HANDOFF_CONFLICT`; atribuição fora do setor → **400** `INVALID_ASSIGNEE`.
- Ações repetidas sem efeito duplicado: mesmo status/handler/assignee/alerta reconhecido/aceite repetido retornam
  `200 deduplicated:true` e não geram histórico/auditoria/outbox novos.

### AC4 — DTOs estáveis e concorrência

- Duas mudanças simultâneas de **estado** da mesma conversa: um `200`, um `409`; histórico=1, auditoria=1, outbox=1.
- Duas mudanças simultâneas de **status** da mesma tarefa: um `200`, um `409`; histórico=1, auditoria=1, outbox=1.
- Duas **transferências** simultâneas do mesmo contato para setores distintos: um `201`, um `409`
  (`TRANSFER_SECTOR_MISMATCH`); exatamente 1 transferência aceita, 1 vínculo ativo e o vínculo aponta para o setor
  final da conversa (convergência).
- Dois **aceites** simultâneos da mesma transferência pendente: nenhum efeito duplicado (auditoria/outbox=1).
- Paginação: `limit/offset` (bounds 1–200; 201+ → 400) e ordem total (`createdAt desc, id desc`) estáveis entre
  chamadas em `/notes`, `/tasks`, `/alerts`, `/transfers`, `/audit/logs`. (Cursor continua restrito a
  `/conversations` — §6.4.)

---

## 4. Matriz de ações sensíveis × auditoria × transação × outbox

Fonte: `evidence-matrix.json` (run `prod18`, worker 42). `missingAudit: []`, `missingOutbox: []`.

| Ação exercitada | Rota | Ator (sessão) | Auditoria (`action`/`entity`) | Mesma transação? | Outbox |
|---|---|---|---|---|---|
| Criar nota | `POST /notes` | Veterinarian + membership A | `note.created` / `note` | **Sim** (nota+histórico de referência+auditoria+evento) | `note.created` |
| Mudar status de tarefa | `PATCH /tasks/:id/status` | Veterinarian | `task.status.changed` / `task` (old/new) | **Sim** (tarefa+histórico+auditoria+evento) | `task.status.changed` |
| Reconhecer alerta | `POST /alerts/:id/acknowledge` | Veterinarian | `alert.acknowledged` / `alert` | **Sim** (alerta+`alert_events`+auditoria+evento) | `alert.acknowledged` |
| Resolver alerta | `POST /alerts/:id/resolve` | Veterinarian | `alert.resolved` / `alert` | **Sim** | `alert.resolved` |
| Criar alerta | `POST /alerts` | Veterinarian | `alert.created` / `alert` | **Sim** (2º caminho e idempotente) | `alert.created` |
| Transferir (auto-accept) | `POST /transfers` | Receptionist/Admin | `contact_transfer.accepted` / `contact_transfer` | **Sim** (transferência+conversa+vínculos+auditoria+evento) | `transfer.accepted` |
| Aceitar/rejeitar transferência | `POST /transfers/:id/{accept,reject}` | Receptionist/Admin | `contact_transfer.{accepted,rejected}` | **Sim** (CAS+movimento+auditoria+evento) | `transfer.{accepted,rejected}` |
| Mudar estado da conversa | `PATCH /conversations/:id/state` | Veterinarian | `conversation.status.changed` / `conversation` | **Sim** (conversa+histórico+auditoria+evento) | `conversation.status.changed` |
| Atribuir responsável | `POST /conversations/:id/assign` | Veterinarian | `conversation.assigned` / `conversation` | **Sim** (conversa+`conversation_assignments`+auditoria+evento) | `conversation.assigned` |
| Handoff bot↔humano | `POST /conversations/:id/handoff` | Veterinarian | `conversation.handoff` / `conversation` | **Sim** | `handoff.requested` + `handoff.completed` |
| Admin usuário (C/U/D) | `POST/PUT/DELETE /admin/users` | Admin | `admin.user.{created,updated,deleted}` / `user` | **Não** (pós-efeito; §6.2) | — |
| Admin papel (C) | `POST /admin/roles` | Admin | `admin.role.created` / `role` | **Não** (pós-efeito; §6.2) | — |
| Fila/time/setores/DLQ | `POST/PUT/DELETE /admin/{queues,teams}`, `PUT/POST/DELETE /admin/users/:id/sectors`, DLQ | Admin | `admin.{queue,team}.*`, `sector.membership.change`, `dlq.{replay,resolve}` | **Não** (pós-efeito; §6.2) | — |
| Mensagem inbound/outbound | webhook / `POST /messages` | sistema/sessão | `message.inbound.received`, `message.outbound.*` | Entidade+outbox **sim** (repositórios atômicos); auditoria **pós-commit** (§6.3) | `message.persisted` etc. |

---

## 5. Comandos e exit codes

Todos os runs usam o runner isolado (PG/Redis próprios; teardown por runId; nunca o banco do host).

```bash
# 1) Repro ANTES — exit 0; veredito DEFECT_REPRODUCED (A–E)
node scripts/production/run-integration-isolated.mjs --run-id prod18-repro --worker 42 \
  -- pnpm exec tsx docs/producao-2026-09-13/evidencias/prod-18/repro-antes.ts

# 2) Suíte PROD-18 (HTTP+PG reais; 18/18) — exit 0
node scripts/production/run-integration-isolated.mjs --run-id prod18 --worker 42 \
  -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-18.test.ts

# 3) Regressão dos módulos operacionais (notes 11, tasks 14, alerts 7, transfers 16, admin 18) — exit 0, 66/66
node scripts/production/run-integration-isolated.mjs --run-id prod18-regressao-modulos --worker 43 \
  -- pnpm --filter @cvg/notes --filter @cvg/tasks --filter @cvg/alerts --filter @cvg/transfers --filter @cvg/admin test

# 4) Regressão HTTP das rotas operacionais (transfers 10, chat 5, sector-authz 9) — exit 0, 24/24
node scripts/production/run-integration-isolated.mjs --run-id prod18-regressao-app --worker 44 \
  -- pnpm --filter @cvg/desk-api exec vitest run --no-file-parallelism \
     src/__tests__/transfers-routes.integration.test.ts \
     src/__tests__/chat-routes.integration.test.ts \
     src/__tests__/sector-authz.integration.test.ts

# 5) Typecheck (8 pacotes) — exit 0 cada
pnpm --filter @cvg/{notes,tasks,alerts,transfers,admin,chat,audit,desk-api} typecheck

# 6) Lint (8 pacotes) — exit 0 cada (warnings dentro do teto; nenhum erro)
pnpm --filter @cvg/{notes,tasks,alerts,transfers,admin,chat,audit,desk-api} lint
```

Trilha de evidência: `logs/prod-18-final.log` + `logs/prod-18-runner-summary.json` (exit 0),
`logs/regressao-modulos*.log` (exit 0), `logs/regressao-app*.log` (exit 0), `logs/repro-antes*.{json,log}`,
`evidence-matrix.json`.

---

## 6. Riscos e limitações (honestos)

1. **Kanban ainda não usa a mutação atômica**: `PATCH /kanban/card/:id/move` (módulo `kanban`, fora do escopo de
   escrita desta tarefa) continua chamando `updateStatusV2`/`updateSector`/`assignUser` separadamente, sem
   auditoria/outbox na mesma transação. As novas operações de estado/atribuição do chat são atômicas e são o
   contrato que o **PROD-27** deve passar a consumir. UI05 fica parcialmente atendida por API.
2. **Auditoria admin pós-efeito**: as mutações administrativas auditam logo após o efeito, no controller (não no
   mesmo `tx`); falha de auditoria responde 500 mas o efeito já commitou. O AC1 transacional cobre as ações
   operacionais (nota/tarefa/alerta/transferência/estado/atribuição/handoff); tornar o admin estritamente
   transacional exige refatorar o repositório do módulo (não fiz para não ampliar o delta).
3. **Auditoria de mensagens fora do `tx`**: `receive-inbound`/`send-outbound` continuam gravando a trilha após o
   commit (repositórios atômicos bloqueados para edição); a durabilidade do efeito está no repositório + outbox
   (provado em PROD-08/10/11). A matriz cobre mensagens com essa classificação explícita.
4. **Paginação por cursor parcial**: `/conversations` mantém cursor opaco; `/notes`, `/tasks`, `/alerts`, `/transfers`,
   `/audit/logs` usam `limit/offset` com ordem total e bounds (estáveis), mas sem `nextCursor` — o item de C07
   ("nota/tarefa/alerta usam limit sem cursor") fica **parcialmente** endereçado.
5. **Handoff durável do worker**: `triggerHandoff` (secretary-adapter, fora do escopo) publica eventos, mas não
   atualiza `current_handler`; o handoff **manual** via HTTP agora é atômico. A convergência do fluxo IA→humano no
   worker permanece nas fronteiras PROD-10/23.
6. **Lock de transferência por contato**: `pg_advisory_xact_lock(hashtext('prod18-transfer:<contactId>'))` serializa
   transferências do mesmo contato (inclusive conversas distintas dele) — comportamento conservador aceitável; não
   há lock distribuído.
7. **`autoAccept` default preservado (`true`)** no schema do `POST /transfers` para compatibilidade; o uso de
   `autoAccept:false` continua explícito.
8. **Fuso da auditoria**: `audit_logs.created_at` é TIMESTAMP sem fuso (DT01); o filtro de período converte o
   instante UTC para o wall time da sessão. Se o fuso do processo de escrita e o da consulta divergirem, a janela
   pode variar por offset — corrigir a coluna exige migração (lock de schema, não tocado).
9. **Suítes AAA históricas `aaa-17`/`aaa-19`**: possuem guarda de ambiente que exige os runs `a17`/`a19` na porta
   56432 (fora do `test:ci`); não executam sob outro runId — por isso o run `prod18-regressao-aaa` termina 1 por
   guarda, e não por regressão. A cobertura equivalente de notas/alerts no fluxo real está em `prod-18` e nas
   regressões de módulo.
10. **HTTP por `app.inject`**: usa o pipeline real de rotas/schema/serialização do app de produção contra PG real,
    mas sem socket TCP externo (o PROD-04 provou o socket real do WS; aqui o foco é o contrato HTTP+PG).
11. **SEM edição de schema/migrations**: nenhuma migração nova; a tabela `audit_logs`, `conversation_status_history`,
    `conversation_assignments`, `outbox_events` e `worker_effect_receipts` já existiam.
12. Testes que exigem runs históricos/ambiente específico (aaa-04, aaa-11, aaa-12, aaa-17, aaa-19) não foram
    reexecutados por essa razão; as regressões acima cobrem as rotas alteradas.

---

## 7. Recuperação e rollback

- **Rollback de código**: reverter os arquivos do §2 (os novos helpers/use-cases/controller são aditivos; o
  `registerOutboundController` volta a não registrar as três rotas). Pontos de entrada antigos continuam válidos
  (assinaturas legadas preservadas: `acknowledgeAlert({acknowledgedBy})`, `resolveAlert({resolvedBy})`,
  `acceptTransfer`/`rejectTransfer` passam a aceitar objeto — único caller é o controller).
- **Schema/dados**: nada de migração; nenhuma linha preexistente alterada. `audit_logs`/outbox ganharam apenas linhas
  novas dos fluxos exercitados.
- **Runs isolados**: todos encerrados pelo runner por runId (`stopServices+dropDatabase`); nenhum processo
  `cvg-aaa-runs/prod18*` ativo (checado). Nenhum banco do host foi tocado.
- **Incidente em produção**: para transferência com efeito parcial legado, reconciliar pelo par
  (`contact_transfers`, `contact_sectors`, `conversations.sector_id`); o lock/transação novo impede a recorrência.
  Para alerta/tarefa com estado sem trilha, a correção leva o estado à trilha via reinício idempotente da ação.

## 8. Próxima ação

Integrador: revisar este delta, decidir sobre os itens §6.1 (fiação do Kanban no PROD-27) e §6.2 (admin
transacional), e confirmar identidade do candidato antes de DONE. Crítico fresco deve reproduzir os negativos
(CAS/403/404/rollback) e conferir `evidence-matrix.json` sem aceitar este relato como prova.
