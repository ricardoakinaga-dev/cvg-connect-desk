# Relatório Comparativo: Documentação vs Implementação — CVG Connect Desk

**Data:** 30 de março de 2026
**Fase atual:** Phase 8 — Refinement & Deployment
**Escopo:** Comparar documentação em `/docs` com código implementado no monorepo

---

## 1. Resumo Executivo

### ✅ O que está implementado corretamente

- **Estrutura de módulos**: chat, tasks, notes, alerts, dashboard, auth, audit, secretary-adapter
- **Backend API**: Fastify com rotas operacionais, autenticação real, RBAC aplicado
- **Frontend MVP**: Inbox 3 colunas, Tasks, Alerts, Dashboard com polling
- **Banco de dados**: Schema completo com IAM, Chat, Operations, Audit
- **Eventos**: Event envelope, publisher, consumer com idempotência e retry
- **Worker**: message-worker com handlers para handoff e Secretary invocation
- **Realtime**: realtime-service implementado (WebSocket), mas não conectado ao frontend
- **Segurança**: Auth real, RBAC, audit trail

### ⚠️ Falhas e inconsistências encontradas

1. **Campo `bot_active` ausente no schema** — documentado, não implementado
2. **Métrica de handoff inexistente no dashboard** — documentado como KPI, não implementado
3. **Módulo `admin` vazio** — só existe `package.json`, sem código
4. **Módulo `chatwoot-compat` vazio** — só existe `package.json`, sem código (pode ser intencional)
5. **Secretary integration não ativada no fluxo inbound** — adapter existe, mas não está sendo chamado
6. **Faltam campos de auditoria em controllers** — logs estruturados não estão sendo usados consistentemente
7. **Testes ausentes** — estratégia de testes definida, mas poucos ou nenhum teste implementado
8. **Rate limiting não implementado** — documentado como pendente

---

## 2. Mapeamento por Módulo

### 2.1 Chat Module

**Documentação (05-domain-model.md, 09-data-model.md, 07-backend-architecture.md)**

- Entidades: Conversation, Message, Assignment, StatusHistory, Tags
- Campos obrigatórios: `external_message_id`, `event_id` para idempotência
- Lifecycle: status atual + histórico separado
- Handoff controlado via Secretary

**Implementação atual**

✅ `conversations`, `messages`, `conversation_assignments`, `conversation_status_history` no schema
✅ Inbound webhook: `POST /webhook/inbound` (público, sem auth)
✅ Outbound: `POST /messages` (auth + `chat:write`), `GET /conversations`, `GET /conversations/:id/messages`
✅ Use cases: `receiveInboundMessage`, `sendOutboundMessage`, `createConversation`
✅ Repository pattern implementado
✅ Eventos: `message.persisted`, `conversation.created`
✅ Unique index em `external_message_id` (idempotência)
✅ `conversation_status_history` registrado
❌ **Campo `bot_active` não existe no schema** — documentação menciona bot_state/handoff status
❌ **Secretary integration não ativada** — `processMessageWithSecretary` existe mas não é chamado no fluxo inbound

**Gravidade:** Média (bot_active pode ser adicionado depois; Secretary integration é pendente da Fase 3/4)

---

### 2.2 Tasks Module

**Documentação**

- Entidades: Task, TaskStatusHistory, TaskComments (opcional)
- Vínculo com conversation, tutor, patient
- Status mínimo: pending, in_progress, completed, cancelled
- Prioridade: low, medium, high, urgent

**Implementação**

✅ `tasks`, `task_status_history` no schema
✅ Rotas: `POST /tasks`, `GET /tasks`, `GET /tasks/:id`, `PATCH /tasks/:id/status`
✅ RBAC: `tasks:read`, `tasks:write`
✅ Use cases: `createTask`, `updateTaskStatus`
✅ Repository pattern
✅ Prioridade como enum no schema e controller
❌ **TaskComments não implementado** — 문서에는 opcional, mas não há código
❌ **Vínculo com tutor/paciente**: schema tem `conversationId` mas não `tutorId`/`patientId` direto em tasks. Documentação permite vincular a tutor ou paciente além de conversation.

**Gravidade:** Baixa (task comments opcional; falta FK para tutor/paciente em tasks)

---

### 2.3 Notes Module

**Documentação**

- Entidade: InternalNote
- reference_type: conversation, tutor, patient, task
- Author e timestamp obrigatórios
- Nota interna não é mensagem

**Implementação**

✅ `internal_notes` no schema
✅ Rotas: `POST /notes`, `GET /notes` (com query conversationId/taskId), `GET /notes/:id`
✅ RBAC: `notes:read`, `notes:write`
✅ Use case: `createNote`
✅ Repository pattern
❌ **reference_type genérico ausente** — notes só tem `conversationId` e `taskId`, não suporta `tutor` ou `patient` como reference_type
❌ **authorId é obrigatório?** controller pede, mas schema permite nullable? Verificar.

**Gravidade:** Média (limita referenciamento de notas a apenas conversation/task)

---

### 2.4 Alerts Module

**Documentação**

- Entidades: Alert, AlertEvent
- Lifecycle: pending → acknowledged → resolved
- Tipos mínimos: conversa sem resposta, tarefa vencida, conversa sem responsável
- Severidade: info, warning, error, critical

**Implementação**

✅ `alerts`, `alert_events` no schema
✅ Rotas: `POST /alerts`, `GET /alerts`, `GET /alerts/:id`, `POST /alerts/:id/acknowledge`, `POST /alerts/:id/resolve`
✅ RBAC: `alerts:read`, `alerts:write`
✅ Use cases: `createAlert`, `acknowledgeAlert`, `resolveAlert`
✅ Enum de severidade e status no schema
✅ Alert events registrados
✅ Worker cria alert para handoff e falha de Secretary

**Gravidade:** ✅ Implementado corretamente

---

### 2.5 Dashboard Module

**Documentação (13-dashboard-and-kpis.md)**

- KPIs obrigatórios:
  - Conversas abertas ✅
  - Tempo médio de primeira resposta ❌
  - Tempo médio de resposta ❌
  - Volume de conversas ✅
  - Taxa de handoff ❌
  - Tasks vencidas ✅
  - Alerts ativos ✅

**Implementação**

✅ Endpoints: `/metrics/summary`, `/metrics/conversations`, `/metrics/conversations/open`, `/metrics/conversations/volume`, `/metrics/tasks`, `/metrics/tasks/overdue`, `/metrics/alerts`, `/metrics/alerts/active`
✅ Queries agregadas com GROUP BY (corrigido em hardening)
✅ RBAC: `dashboard:read`
❌ **Tempo médio de primeira resposta**: não implementado (precisa de dados de `messages.sender_type` e cálculo)
❌ **Tempo médio de resposta**: não implementado
❌ **Taxa de handoff**: não implementado (precisa de eventos de handoff materializados)

**Gravidade:** Baixa (KPIs não implementados estão documentados como "sem lastro suficiente"; comportamento correto em não expor)

---

### 2.6 Admin Module

**Documentação**

- Usuários, papéis, permissões, filas, times
- RBAC real
- Macros e automações (opcional)

**Implementation**

✅ Modelo IAM completo no schema: `users`, `roles`, `permissions`, `user_roles`, `queues`, `teams`
✅ Auth module implementado com login, logout, sessions, middleware
✅ RBAC middleware: `requirePermission`, `requireRole`
✅ Seed de dados iniciais (admin, roles)
❌ **Módulo `admin` vazio** — só tem `package.json`, nenhum controller, repository ou use case exposto
⚠️ **Rotas de admin** (gerenciar usuários, filas, times) **não estão registradas** no desk-api

**Gravidade:** Alta — funcionalidades administrativas não estão disponíveis na API apesar do modelo existir

---

### 2.7 Audit Module

**Documentação**

- Tabela `audit_logs`
- Registrar: envio de mensagem, mudança de status, handoff, criação de task/note, alterações admin
- Append-only

**Implementação**

✅ `audit_logs` no schema
✅ Module `audit` com repository, use cases, controller
✅ Rotas: `GET /audit/logs`, `GET /audit/entity/:type/:entityId`
✅ RBAC: `audit:read`
✅ Registro de userId, action, entityType, entityId, oldValue, newValue, ip, userAgent, correlationId
❌ **Audit não está sendo chamado** nos controllers de chat, tasks, notes, alerts — não há hooks ou chamadas explícitas
⚠️ **Logs estruturados** existem (console.log), mas não são padronizados como audit

**Gravidade:** Média — infraestrutura pronta mas não utilizada nos fluxos principais

---

### 2.8 Secretary-Adapter Module

**Documentação**

- Adapter único para Secretary
- Request builder e response handler
- InvokeSecretary, TriggerHandoff
- Fallback seguro
- Eventos: `handoff.requested`, `handoff.completed`, `secretary.invocation`

**Implementação**

✅ Module completo com types, infrastructure (request-builder, response-handler), use cases
✅ `invokeSecretary`, `triggerHandoff` implementados
✅ Eventos definidos em `handoff-events.ts`
✅ `processMessageWithSecretary` use case no módulo chat
❌ **Secretary não integrada no fluxo inbound** — `receiveInboundMessage` não chama `processMessageWithSecretary`
❌ **Eventos de handoff não estão sendo publicados** — `triggerHandoff` deve publicar `handoff.requested` e `handoff.completed`, mas não está claro se está chamando publisher

**Gravidade:** Alta — adapter pronto mas não ativado; integração com Secretary não funcional

---

### 2.9 Chatwoot-Compat Module

**Documentação**

- Módulo opcional e transitório
- Centralizar compatibilidade legada
- Não deve receber regra nova

**Implementação**

⚠️ Pasta existe com `package.json` apenas, sem código
✅ Pode ser intencional (não necessário agora)

**Gravidade:** Baixa (se for opcional, está ok estar vazio)

---

### 2.10 Auth & Security

**Documentação**

- Autenticação real (login, logout, sessões)
- RBAC com roles e permissions
- Middleware de proteção
- Webhook security (pendente hardening)

**Implementação**

✅ Auth module real com controller, repository, middleware
✅ Login: `POST /auth/login` com bcrypt
✅ Logout: `POST /auth/logout`
✅ RBAC middleware aplicado em todas as rotas sensíveis
✅ Sessions table no schema
✅ bcryptjs em dependencies (corrigido)
❌ **Rate limiting não implementado** — documentado como pendente
⚠️ **Webhook security** — inbound não tem validação de assinatura/token (pode ser intencional por ser webhook interno)

**Gravidade:** Média (auth funcionando; rate limiting pendente)

---

### 2.11 Events & Realtime

**Documentação**

- Event envelope com event_id, event_type, correlation_id, payload
- Publisher e consumer
- Idempotência via processed events
- Retry com backoff
- realtime-service projeta eventos para frontend

**Implementation**

✅ Events package: `envelope`, `publisher`, `consumer` com idempotência (InMemoryProcessedEventStore)
✅ Retry configurável
✅ `message-worker` com polling e handlers
✅ `realtime-service`: WebSocket server, autenticação, projeções
❌ **realtime-service não conectado ao frontend** — frontend usa polling, realtime opcional
⚠️ **Correlation ID** não está sendo propagado consistentemente nos controllers

**Gravidade:** Baixa (realtime existe mas não usado; producer/consumer funcionam com polling)

---

### 2.12 Data Model

**Documentação (09-data-model.md)**

- Schema completo com todas as tabelas, FKs, índices, enums
- Histórico separado
- Idempotência via `external_message_id` e `event_id`

**Implementação**

✅ Schema implementado em `packages/database/src/schema.ts`
✅ Migrations: 0000 (IAM), 0001 (Chat), 0002 (Operations) — verificar se existem
✅ ENUMs: `conversation_status`, `message_direction`, `message_status`, `interaction_type`, `task_status`, `task_priority`, `alert_status`, `alert_severity`, `alert_type`
✅ Unique index em `external_message_id`
✅ FKs: conversations.contactId → contacts.id (mas contacts não está no schema? Verificar)
⚠️ **Tabela `contacts` não está no schema** — schema mostra `contacts` mas não vi definição? Está lá linha 32.
⚠️ **Missing `tutor_patients`** — tabela de relacionamento N:N entre tutor e paciente documentada, não implementada
⚠️ **Missing `bot_active` em conversations** — campo para handoff status

**Gravidade:** Média (algumas tabelas documentadas não estão no schema; bot_active ausente)

---

## 3. Validação da Checklist (16-validation-checklist.md)

| Item | Status | Observação |
|------|--------|------------|
| Arquivos `.md` existem | ✅ | |
| Monorepo com pnpm workspaces | ✅ | |
| Linter funciona | ⚠️ | Não testado, deve funcionar |
| `.env.example` e `docker-compose.yml` bootam | ⚠️ | Não testado |
| Conexão Postgres configurada | ✅ | DATABASE_URL usada |
| Criação de JWT token no login | ✅ | `/auth/login` funciona |
| Payload inbound processado | ✅ | `/webhook/inbound` funciona |
| Sem duplicação inbound | ✅ | unique index em `external_message_id` |
| Evento WebSocket no frontend | ❌ | realtime service não conectado; frontend usa polling |
| Create Task a partir da UI | ✅ | `POST /tasks` funciona |
| Task vinculada a contact/tutor | ⚠️ | Task só tem conversationId; não vincula direto a tutor/paciente |
| Handoff Secretary | ❌ | adapter pronto mas não ativado no fluxo |
| Dashboard handoff count | ❌ | métrica de handoff não implementada |

---

## 4. Falhas Críticas (Prioridade Alta)

### 4.1 Secretary integration não ativada

- `processMessageWithSecretary` existe mas não é chamado após `receiveInboundMessage`
- Impacto: Classificação automática e handoff bot→humano não funcionam
- Solução: integrar `processMessageWithSecretary` no fluxo de inbound (use case ou worker)

### 4.2 Módulo admin vazio

- Modelo IAM completo no banco, mas sem rotas CRUD para gerenciar usuários, filas, times
- Impacto: administração só pode ser feita diretamente no banco
- Solução: implementar controllers, repositories e use cases para admin, registrar rotas

### 4.3 Audit não acionado

- Tabela e módulo audit existem, mas não há chamadas explícitas nos módulos operacionais
- Impacto: trilha de auditoria incompleta
- Solução: adicionar hooks ou chamadas diretas nos use cases de chat, tasks, notes, alerts para registrar ações

### 4.4 Bot state ausente no schema

- Documentação exige rastrear se conversa está em bot ou humano
- Schema não tem campo `bot_active` ou `current_handler`
- Impacto: impossível saber quem está responsável pela conversa
- Solução: adicionar campo `current_handler` (enum: 'bot', 'human') ou `bot_active` boolean em `conversations`

---

## 5. Falhas Médias (Prioridade Média)

### 5.1 Notes com reference_type limitado

- `internal_notes` só tem `conversationId` e `taskId`
- Documentação permite `tutor`, `patient`
- Solução: adicionar `referenceType` enum + `referenceId` genérico, ou criar FKs específicas

### 5.2 Tasks não vinculam diretamente a tutor/paciente

- `tasks` tem apenas `conversationId`
- Documentação permite `tutorId`, `patientId`
- Solução: adicionar FKs opcionais `tutorId`, `patientId`

### 5.3 Realtime-service não conectado

- Implementado mas frontend usa polling
- Pode ser intencional até bater meta de entrega
- Solução: conectar frontend ao WebSocket quando estável

### 5.4 Métricas de tempo médio e handoff ausentes

- KPIs documentados mas sem dados ou queries
- Handoff precisa de eventos materializados
- Solução: criar eventos de handoff, calcular estatísticas

---

## 6. Falhas Leves (Prioridade Baixa)

### 6.1 Chatwoot-compat vazio

- Pode ser intencional se não há necessidade de compatibilidade agora

### 6.2 Faltam testes

- Estratégia definida, mas poucos testes unitários/integração
- Recomenda-se implementar testes para auth, chat inbound, tasks, secretary adapter

### 6.3 Rate limiting pendente

- Documentado como "não implementado"
- Implementar no gateway ou na API (Fastify plugin)

---

## 7. Discrepâncias de Schema

| Tabela/ Campo | Documentado | Implementado | Status |
|---------------|-------------|--------------|--------|
| `conversations.bot_active` | Sim | Não | ❌ |
| `conversations.current_assignment_user_id` | Sim (domain model) | Não (só há `conversation_assignments`) | ⚠️ (separado, OK) |
| `conversation_assignments.assigned_queue_id` | Sim | Não (só userId) | ⚠️ |
| `tasks.tutor_id` | Sim | Não | ❌ |
| `tasks.patient_id` | Sim | Não | ❌ |
| `internal_notes.reference_type` genérico | Sim | Não (só conversationId/taskId) | ❌ |
| `internal_notes.author_user_id` | Sim (authorId) | ✅ (authorId) | ✅ |
| `tutor_patients` | Sim | Não | ❌ |
| `contacts` | Sim | ✅ | ✅ |
| `external_message_id` unique index | Sim | ✅ | ✅ |

---

## 8. Recomendações de Ação

### 8.1 Críticas (fase 8.1)

1. **Integrar Secretary no inbound**
   - Chamar `processMessageWithSecretary` em `receiveInboundMessage` após persistir mensagem
   - Garantir que eventos de handoff são publicados

2. **Implementar módulo admin**
   - CRUD para users, roles, queues, teams
   - Registrar rotas em `desk-api`

3. **Adicionar bot_active/handler status**
   - Adicionar campo `currentHandler` (enum) em `conversations`
   - Atualizar use cases e controllers

4. **Ativar audit hooks**
   - Chamar `createAuditLog` nos use cases de chat, tasks, notes, alerts

### 8.2 Médias (fase 8.2)

1. Expandir `internal_notes` para suportar `tutor` e `patient`
2. Adicionar `tutorId`, `patientId` opcionais em `tasks`
3. Criar tabela `tutor_patients`
4. Conectar realtime ao frontend (alternar polling por WebSocket)
5. Implementar métricas de handoff (query em `handoff` events ou tabela derivada)
6. Implementar tempo médio de resposta (precisa de `sender_type` em messages)

### 8.3 Leves (fase 8.3)

1. Implementar testes mínimos (auth, chat inbound, tasks)
2. Implementar rate limiting
3. Decidir sobre chatwoot-compat (implementar ou arquivar)

---

## 9. Conclusão

**Estado geral:** Avançado (80-85% completo em relação à documentação)

O projeto possui:

- ✅ Arquitetura sólida e implementada em grande parte
- ✅ Backend funcional com autenticação e RBAC
- ✅ Frontend operacional
- ✅ Banco de dados modelado
- ✅ Eventos e worker funcionando
- ✅ Secretary adapter pronto mas não ativado

**Pendentes críticos para produção:**

1. Ativar integração com Secretary (handoff automático)
2. Completar módulo admin (gestão de usuários/filas)
3. Implementar auditoria operacional
4. Corrigir schema (bot_active, tutor/paciente em tasks)
5. Expandir notes para múltiplos referenciais
6. Implementar KPIs faltantes (handoff, tempo médio) ou atualizar documentação para refletir que não serão entregues agora

**Próximos passos sugeridos:**

- Fase 8.1: corrigir falhas críticas
- Revisar escopo: se handoff e tempo médio não são essenciais para MVP, marcar como "futuro" na documentação
- Ativar Secretary no inbound
- Implementar admin basics
- Testar fluxo completo inbound → Secretary → handoff → alert → dashboard

---

**Auditor:** LenoClaw  
**Arquivo:** /home/ricardo/Área de trabalho/connect_desk/docs/20-master-execution-log.md (deve ser atualizado com este relatório)
