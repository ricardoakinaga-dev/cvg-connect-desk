# PLANO EXECUTIVO DE IMPLEMENTAÇÃO — ENTERPRISE PREMIUM

> **⚠️ DOCUMENTO REBASELINADO — 2026-04-09**
>
> Este documento foi revisado e reclassificado. Muitas fases listadas abaixo já foram implementadas.
> Antes de usar como plano de ação, verificar a coluna "Estado Atual" na tabela abaixo.
>
> Para o estado mais atualizado do projeto, consultar:
> - `docs/26-relatorio-analise-documentacao-vs-implementacao.md`
> - `docs/27-relatorio-executivo-rastreabilidade-documentacao-vs-codigo.md`
> - `docs/60-relatorio-consolidado-estado-construcao-cvg-connect-desk.md`

**Data:** 2026-04-09 (original: 2026-04-09)
**Fase Atual:** Enterprise Premium — Baseline 2026-04-09
**Objetivo:** Rastrear pendências remanescentes para produção enterprise-ready

---

## ESTADO REAL DO PROJETO (Revalidado 2026-04-09)

### Fases do Plano — Estado Atual

| Fase | Nome | Estado | Evidência |
|------|------|--------|-----------|
| **Fase 9.1** | Realtime Ativo | ✅ **IMPLEMENTADO** | `apps/desk-web/src/pages/Inbox.tsx:58` — realtime conectado |
| **Fase 9.2** | Secretary IA Ativada | ✅ **IMPLEMENTADO** | `modules/chat/.../receive-inbound-message.use-case.ts:150` — chamada integrada |
| **Fase 9.3** | Kanban Drag-Drop | ✅ **IMPLEMENTADO** | `modules/kanban/.../kanban.controller.ts:89` — endpoint PATCH existe |
| **Fase 9.4** | Suite de Testes | 🔄 **PARCIAL** | Testes existem, cobertura limitada — ver doc 25 |
| **Fase 9.5** | Hardening Final | 🔄 **PARCIAL** | Rate limiting feito; monitoring e webhook hardening pendentes |

**Total estimado restante:** reavaliado. O restante real já não é um bloco curto de 2-4 dias; hoje o trabalho remanescente está concentrado em cobertura enterprise, observabilidade, runtime/deploy e amadurecimento das frentes premium.

---

## COMO INTERPRETAR ESTE DOCUMENTO

Este documento mantém as descrições técnicas originais como **referência de evolução**.
As fases 9.1, 9.2 e 9.3 estão **implementadas** e não requerem trabalho adicional além de validação.

**O trabalho restante real é:**
1. Expandir cobertura de testes (Fase 9.4 — em andamento)
2. Hardening adicional de webhook e monitoring (Fase 9.5 — pendente)

---

## FASE 9.1 — REALTIME ATIVO

> **Status: ✅ IMPLEMENTADO**
> Ver证据: `apps/desk-web/src/pages/Inbox.tsx:58` — `realtimeClient.connect(user.id, token)`
> Ver证据: `apps/realtime-service/src/index.ts` — WebSocket server funcionando na porta 8080

### 1.1 Objetivo (Original)

Substituir o polling de 10 segundos por conexão WebSocket real, proporcionando atualização instantânea de mensagens e status — igual ou superior ao Chatwoot.

### 1.2 Arquitetura Atual

```
Frontend (polling)          Realtime Service (existente mas desconectado)
┌──────────────┐            ┌────────────────────────┐
│ Inbox.tsx    │───poll───▶│ apps/realtime-service │
│ 10 segundos  │            │ WebSocket server :8080 │
└──────────────┘            └────────────────────────┘
```

### 1.3 Arquitetura Alvo

```
Frontend (WebSocket)        Realtime Service           desk-api
┌──────────────┐            ┌────────────────────────┐   ┌──────────────┐
│ Inbox.tsx    │◀═════════▶│ apps/realtime-service  │◀──│ events/     │
│ realtime     │  WS con    │ - auth handshake       │   │ publisher   │
└──────────────┘            │ - projections          │   └──────────────┘
                           └────────────────────────┘
```

### 1.4 Arquivos a Modificar

#### Backend — realtime-service

**`apps/realtime-service/src/index.ts`**
```typescript
// Estado atual: WebSocket server implementado
// Necessário verificar:
// 1. Autenticação por token JWT no handshake
// 2. Projeções corretas para:
//    - conversation.created
//    - message.persisted
//    - conversation.status.changed
//    - conversation.assigned
//    - task.created/updated
//    - alert.created/acknowledged/resolved
// 3. Broadcast para canal correto por usuário/setor
```

**Verificar existência e implementar se necessário:**
```typescript
// projection para inbox
interface InboxProjection {
  type: 'conversation' | 'message' | 'assignment' | 'status';
  data: any;
  timestamp: string;
}
```

#### Frontend — desk-web

**`apps/desk-web/src/lib/realtime.ts` (NOVA IMPLEMENTAÇÃO)**
```typescript
// Criar client WebSocket centralizado
interface RealtimeClient {
  connect(token: string): void;
  disconnect(): void;
  onConversationUpdate(handler: (conv: Conversation) => void): void;
  onMessageReceived(handler: (msg: Message) => void): void;
  onKanbanUpdate(handler: (card: KanbanCard) => void): void;
}
```

**`apps/desk-web/src/pages/Inbox.tsx`**
```typescript
// Substituir:
const i = setInterval(fetchConversations, 10000);

// Por:
useEffect(() => {
  const client = new RealtimeClient();
  client.connect(token);
  client.onMessageReceived((msg) => {
    if (msg.conversationId === selectedConv) {
      setMessages(prev => [...prev, msg]);
    }
    fetchConversations();
  });
  return () => client.disconnect();
}, [token, selectedConv]);
```

### 1.5 Fluxo de Eventos a Implementar

```
desk-api publica evento
        │
        ▼
realtime-service consome
        │
        ▼
projeta para canal correto
        │
        ▼
frontend recebe via WS
        │
        ▼
atualiza estado React
        │
        ▼
UI atualiza sem reload
```

### 1.6 Endpoints/Eventos Realtime Necessários

| Evento | Payload | Ação no Frontend |
|--------|---------|-----------------|
| `conversation:created` | `{ id, contactId, sectorId, status }` | Adicionar à lista |
| `conversation:updated` | `{ id, status, assignedUserId }` | Atualizar card |
| `message:received` | `{ id, conversationId, content, sender }` | Adicionar à timeline |
| `conversation:assigned` | `{ id, assignedUserId, queueId }` | Atualizar badge |
| `conversation:status` | `{ id, status, statusV2 }` | Mover no Kanban |
| `alert:created` | `{ id, severity, title }` | Mostrar notificação |
| `task:updated` | `{ id, status, assignedTo }` | Atualizar painel |

### 1.7 Canais de WebSocket

```
ws://localhost:8080?token=<jwt>

Canais por usuário:
  - user:<userId>        → conversas atribuídas
  - sector:<sectorId>    → todas do setor
  - global               → admin/gestor
```

### 1.8 Critérios de Validação

- [ ] Nova mensagem aparece em < 500ms após envio
- [ ] Mudança de status atualiza imediatamente
- [ ] Reconexão automática após perda de conexão
- [ ] Sem duplicate messages após reconnect
- [ ] Fallback para polling se WS falhar

### 1.9 Riscos e Mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| WS conexão cai | Perda de updates | Fallback para polling |
| Eventos fora de ordem | UI inconsistente | Timestamp + revalidação |
| Muitos clientes | Performance | Canal por usuário/setor |
| Token expira | Desconexão | Refresh token + reconnect |

---

## FASE 9.2 — SECRETARY IA ATIVADA

> **Status: ✅ IMPLEMENTADO**
> Ver evidência: `modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts:150`
> O fluxo chama `processMessageWithSecretary()` quando `currentHandler === 'bot'`

### 2.1 Objetivo (Original — Cumprido)

Integrar o `secretary-adapter` no fluxo de inbound para ativar classificação automática e handoff bot→humano.

### 2.2 Fluxo Atual (JÁ FUNCIONA)

```
Gateway → webhook/inbound → receiveInboundMessage
                                    │
                              (chama sim)
                                    ▼
                         processMessageWithSecretary ✅
                                    │
                              handoff se necessário ✅
```
                          processMessageWithSecretary ❌
```

### 2.3 FLUXO ALVO (CORRIGIDO)

```
Gateway → webhook/inbound → receiveInboundMessage
                                    │
                                    ▼ persistência
                            message.persisted event
                                    │
                        ┌───────────┴───────────┐
                        │                       │
                  SSE/Polling              message-worker
                  (realtime)                    │
                                                ▼
                                    processMessageWithSecretary
                                                │
                                    ┌───────────┴───────────┐
                                    │                       │
                              action: respond        action: handoff
                                    │                       │
                              resposta via          triggerHandoff
                              gateway                ───────────────
                                                               │
                                                        conversa.status
                                                        → 'open'
                                                        → assignedTo
                                                        → currentHandler
                                                        → 'human'
```

### 2.4 Arquivos a Modificar

#### Fluxo Síncrono (desk-api)

**`modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts`**
```typescript
// ADICIONAR após persistência da mensagem:
// 1. Publicar evento message.persisted
// 2. NOVO: Chamar processMessageWithSecretary

import { processMessageWithSecretary } from './process-message-with-secretary.use-case';

export async function receiveInboundMessage(dto) {
  // ... persistência existente ...

  // Publicar evento
  await publishEvent('message.persisted', { messageId, conversationId });

  // NOVO: Invocar Secretary (via worker para não bloquear)
  // Se for implementação async:
  await enqueueJob('process-with-secretary', { messageId, conversationId });

  // Se for implementação sync (requer timeout):
  setTimeout(async () => {
    await processMessageWithSecretary({ messageId, conversationId });
  }, 0);

  return { messageId, conversationId };
}
```

#### Worker (message-worker)

**`apps/message-worker/src/index.ts`**
```typescript
// ADICIONAR handler para secretary

interface SecretaryJob {
  type: 'process-with-secretary';
  data: { messageId: string; conversationId: string };
}

async function handleSecretaryJob(job: SecretaryJob) {
  const { messageId, conversationId } = job.data;

  // Buscar mensagem e contexto
  const message = await messageRepo.findById(messageId);
  const conversation = await conversationRepo.findById(conversationId);

  // Invocar Secretary
  const result = await invokeSecretary({
    messages: [message],
    context: {
      tutorId: conversation.tutorId,
      patientId: conversation.patientId,
    }
  });

  if (result.action === 'handoff') {
    await triggerHandoff({
      conversationId,
      reason: result.reason,
      priority: result.priority,
    });
  }
}
```

#### Secretary Adapter

**`modules/secretary-adapter/src/application/use-cases/invoke-secretary.use-case.ts`**
```typescript
// Verificar se está implementado corretamente

interface SecretaryRequest {
  messages: Message[];
  context: {
    tutorId?: string;
    patientId?: string;
    sectorId?: string;
  };
}

interface SecretaryResponse {
  action: 'respond' | 'handoff' | 'await';
  response?: string;
  confidence: number;
  reason?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
}

export async function invokeSecretary(request: SecretaryRequest): Promise<SecretaryResponse> {
  // Implementação existente a verificar
}
```

**`modules/secretary-adapter/src/application/use-cases/trigger-handoff.use-case.ts`**
```typescript
// Verificar se:
// 1. Atualiza conversation.status → 'open'
// 2. Atualiza conversation.currentHandler → 'human'
// 3. Publica evento handoff.requested
// 4. Não atribui automaticamente a usuário (fica na fila)

export async function triggerHandoff(dto) {
  // 1. Buscar conversation
  const conversation = await conversationRepo.findById(dto.conversationId);

  // 2. Atualizar status
  await conversationRepo.update(dto.conversationId, {
    status: 'open',
    statusV2: 'em_atendimento',
    currentHandler: 'human',
    // NÃO seta assignedUserId - fica disponível na fila
  });

  // 3. Registrar histórico
  await conversationStatusHistory.create({
    conversationId: dto.conversationId,
    status: 'open',
    changedBy: null, // sistema
    reason: `Handoff: ${dto.reason}`,
  });

  // 4. Publicar evento
  await publishEvent('handoff.completed', {
    conversationId: dto.conversationId,
    from: 'bot',
    to: 'human',
    reason: dto.reason,
  });

  // 5. Criar alerta se necessário
  await createAlert({
    type: 'assignment',
    title: 'Handoff para atendimento humano',
    conversationId: dto.conversationId,
    severity: dto.priority === 'urgent' ? 'critical' : 'info',
  });
}
```

### 2.5 Configuração Necessária

**`.env`**
```env
SECRETARY_URL=http://localhost:8083
SECRETARY_API_KEY=your-api-key
SECRETARY_TIMEOUT_MS=30000
```

### 2.6 Critérios de Validação

- [ ] Mensagem inbound dispara chamada à Secretary
- [ ] Resposta da Secretary persiste corretamente
- [ ] Handoff muda status para 'open' e handler para 'human'
- [ ] Evento handoff.completed é publicado
- [ ] Alerta de handoff é criado
- [ ] Se Secretary indisponível, fallback funciona (conversa continua como bot)
- [ ] Sem duplicação de mensagens
- [ ] Sem bloqueio do webhook (async via worker)

### 2.7 Riscos e Mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Secretary lenta | Webhook timeout | Async via worker |
| Secretary fora | Sem handoff | Fallback: permanece bot |
| Handoff em loop | Bot↔human infinito | Max handoffs por conversa |
| Mensagem duplicada | two responses | Idempotência por event_id |

---

## FASE 9.3 — KANBAN DRAG-DROP

> **Status: ✅ IMPLEMENTADO**
> Ver evidência: `modules/kanban/src/presentation/http/kanban.controller.ts:89`
> O endpoint `PATCH /kanban/card/:id/move` existe e está registrado na API.

### 3.1 Objetivo (Original — Cumprido)

Tornar o Kanban interativo com drag-and-drop funcional para mover cards entre colunas.

### 3.2 FLUXO ALVO

```
Usuário arrasta card
        │
        ▼
Frontend: onDrop event
        │
        ▼
API: PATCH /kanban/card/:id/move
        │
        ├── Validate: usuário tem permissão
        ├── Validate: transição de status válida
        ├── Update: conversation.statusV2
        ├── Update: conversation.updatedAt
        ├── Publicar: conversation.status.changed
        └── Response: { success, newStatus }
        │
        ▼
Frontend: atualizar UI
        │
        ▼
Realtime: notificar outros clientes
```

### 3.3 Arquivos a Implementar

#### Backend — Kanban Repository

**`modules/kanban/src/infrastructure/kanban.repository.ts`**
```typescript
// NOVO: Método de move

interface MoveCardDTO {
  conversationId: string;
  newStatus: ConversationStatusV2;
  newSectorId?: string;
  userId: string;
}

export async function moveCard(dto: MoveCardDTO) {
  // 1. Validar transição de status
  const validTransitions: Record<ConversationStatusV2, ConversationStatusV2[]> = {
    'novo': ['em_atendimento', 'pendente', 'em_espera'],
    'em_atendimento': ['pendente', 'em_espera', 'finalizado'],
    'pendente': ['em_atendimento', 'novo'],
    'em_espera': ['em_atendimento', 'pendente'],
    'finalizado': ['em_atendimento'], // reabrir
    'arquivado': ['novo'], // restaurar
  };

  const conversation = await conversationRepo.findById(dto.conversationId);
  if (!validTransitions[conversation.statusV2]?.includes(dto.newStatus)) {
    throw new AppError('INVALID_STATUS_TRANSITION', 400);
  }

  // 2. Atualizar conversation
  await conversationRepo.update(dto.conversationId, {
    statusV2: dto.newStatus,
    sectorId: dto.newSectorId ?? conversation.sectorId,
    updatedAt: new Date(),
  });

  // 3. Registrar histórico
  await conversationStatusHistory.create({
    conversationId: dto.conversationId,
    status: dto.newStatus,
    changedBy: dto.userId,
    reason: `Kanban drag-drop para ${dto.newStatus}`,
  });

  // 4. Publicar evento
  await publishEvent('conversation.status.changed', {
    conversationId: dto.conversationId,
    oldStatus: conversation.statusV2,
    newStatus: dto.newStatus,
    changedBy: dto.userId,
  });

  return { success: true, newStatus: dto.newStatus };
}
```

#### Backend — Kanban Controller

**`modules/kanban/src/presentation/http/kanban.controller.ts`**
```typescript
// NOVO endpoint

interface MoveCardSchema {
  params: { conversationId: string };
  body: { newStatus: string; newSectorId?: string };
}

app.patch('/kanban/card/:conversationId/move', {
  schema: {
    params: { conversationId: { type: 'string' } },
    body: {
      type: 'object',
      properties: {
        newStatus: { type: 'string', enum: ['novo', 'em_atendimento', 'pendente', 'em_espera', 'finalizado', 'arquivado'] },
        newSectorId: { type: 'string', nullable: true },
      },
      required: ['newStatus'],
    },
    security: [{ bearerAuth: [] }],
  },
  preHandler: [requirePermission('chat:write')],
}, async (request) => {
  const { conversationId } = request.params;
  const { newStatus, newSectorId } = request.body;
  const userId = request.user.id;

  return kanbanRepository.moveCard({
    conversationId,
    newStatus,
    newSectorId,
    userId,
  });
});
```

#### Frontend — Kanban Board

**`apps/desk-web/src/pages/Kanban.tsx`**
```typescript
// Usar biblioteca de drag-drop (ex: @dnd-kit ou react-beautiful-dnd)

import { DndContext, DragEndEvent, DragOverlay } from '@dnd-kit/core';
import { useState } from 'react';

function KanbanBoard() {
  const [activeCard, setActiveCard] = useState<KanbanCard | null>(null);

  function handleDragStart(event: DragStartEvent) {
    const card = findCardById(event.active.id);
    setActiveCard(card);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveCard(null);

    if (!over) return;

    const conversationId = active.id as string;
    const newStatus = over.id as ConversationStatusV2;

    // API call
    try {
      await kanbanApi.moveCard(conversationId, newStatus);
      // Realtime handle ou re-fetch
    } catch (error) {
      // Reverter UI
      toast.error('Falha ao mover card');
    }
  }

  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="kanban-columns">
        {columns.map(column => (
          <DroppableColumn key={column.id} id={column.id}>
            {cards.filter(c => c.status === column.id).map(card => (
              <DraggableCard key={card.id} id={card.id} card={card} />
            ))}
          </DroppableColumn>
        ))}
      </div>
      <DragOverlay>{activeCard && <KanbanCard card={activeCard} isDragging />}</DragOverlay>
    </DndContext>
  );
}
```

**`apps/desk-web/src/lib/api.ts` (adicionar)**
```typescript
// Adicionar método de move
export const kanbanApi = {
  moveCard: (conversationId: string, newStatus: string) =>
    api.patch(`/kanban/card/${conversationId}/move`, { newStatus }),
};
```

### 3.4 Critérios de Validação

- [ ] Card arrasta smoothly entre colunas
- [ ] API é chamada com status correto
- [ ] Status no banco é atualizado
- [ ] UI reflete novo status imediatamente
- [ ] Outros clientes veem atualização (realtime)
- [ ] Transição inválida é rejeitada (ex: novo → finalizado)
- [ ] Permissão `chat:write` é verificada

### 3.5 Riscos e Mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Drag em mobile | Experiência ruim | fallback: menu de ações |
| Race condition | Status inconsistente | Optimistic update + rollback |
|many cards | Performance | Virtual scrolling |
| Permissão | Ação indevida | RBAC verificado no backend |

---

## FASE 9.4 — SUITE DE TESTES

> **Status: 🔄 EM ANDAMENTO**
> Ver evidência: `pnpm test` executa com sucesso
> Ver docs: `docs/25-plano-testes-completo.md` (atualizado com estado real)
>
> **O que existe:** Infraestrutura Vitest, testes em apps/packages/modules
> **O que falta:** Cobertura >70%, testes E2E, testes comportamentais específicos

### 4.1 Objetivo (Original — Parcialmente Cumprido)

Implementar suite de testes para garantir qualidade enterprise e CI/CD readiness.

### 4.2 Stack de Testes

O projeto possui:
- ✅ Vitest como dependência
- ✅ Jest compatível via ts-jest
- ✅ Testes estruturais em `apps/desk-api/src/__tests__/`, `apps/desk-web/src/__tests__/`
- ✅ Testes em `packages/shared/src/__tests__/`, `packages/events/src/__tests__/`
- ✅ `pnpm test` executa com sucesso

**Pendente:** Cobertura >70%, testes E2E, testes comportamentais详见 doc 25

### 4.3 Estrutura de Testes

```
apps/
  desk-api/
    src/
      __tests__/
        auth.test.ts
        chat.test.ts
        tasks.test.ts
        webhooks.test.ts

packages/
  events/
    src/
      __tests__/
        publisher.test.ts
        consumer.test.ts
        idempotency.test.ts

modules/
  chat/
    __tests__/
      receive-inbound.test.ts
      send-outbound.test.ts
  secretary-adapter/
    __tests__/
      invoke-secretary.test.ts
      trigger-handoff.test.ts
```

### 4.4 Testes Obrigatórios

#### 4.4.1 Auth Tests

**`apps/desk-api/src/__tests__/auth.test.ts`**
```typescript
describe('Auth', () => {
  test('login returns JWT with correct claims');
  test('login fails with invalid credentials');
  test('protected route rejects without token');
  test('protected route accepts with valid token');
  test('expired token is rejected');
  test('RBAC middleware enforces permissions');
});
```

#### 4.4.2 Chat Inbound Tests (CRÍTICO — SMOKE TEST)

**`apps/desk-api/src/__tests__/chat-inbound.test.ts`**
```typescript
describe('Chat Inbound', () => {
  test('webhook accepts valid payload and returns 200');
  test('webhook persists message to database');
  test('duplicate event_id does NOT create duplicate message (idempotência)');
  test('webhook rejects payload without required fields');
  test('webhook creates conversation if not exists');
  test('webhook attaches to existing conversation by external_id');
});
```

**TESTE DE IDEMPOTÊNCIA (obrigatório):**
```typescript
test('idempotência: mesmo event_id enviado 3x = 1 mensagem', async () => {
  const payload = {
    event_id: 'evt_123',
    external_message_id: 'msg_456',
    message: { type: 'text', content: 'Oi' },
    // ... campos obrigatórios
  };

  await webhook.post(payload);
  await webhook.post(payload);
  await webhook.post(payload);

  const count = await db.select().from(messages)
    .where(eq(messages.externalMessageId, 'msg_456'));

  expect(count).toBe(1); // NÃO 3!
});
```

#### 4.4.3 Tasks Tests

**`modules/tasks/__tests__/create-task.test.ts`**
```typescript
describe('Tasks', () => {
  test('createTask persists with correct fields');
  test('createTask links to conversation when provided');
  test('updateTaskStatus transitions correctly');
  test('updateTaskStatus rejects invalid transitions');
  test('overdue tasks are correctly identified');
});
```

#### 4.4.4 Secretary Adapter Tests

**`modules/secretary-adapter/__tests__/invoke-secretary.test.ts`**
```typescript
describe('Secretary Adapter', () => {
  test('invokeSecretary builds correct request payload');
  test('invokeSecretary handles handoff action');
  test('invokeSecretary handles respond action');
  test('invokeSecretary throws on invalid response');
  test('invokeSecretary times out after threshold');
});

describe('Handoff', () => {
  test('triggerHandoff updates conversation to human');
  test('triggerHandoff does NOT assign to specific user');
  test('triggerHandoff publishes handoff.completed event');
  test('triggerHandoff creates alert');
});
```

#### 4.4.5 Events Tests

**`packages/events/src/__tests__/idempotency.test.ts`**
```typescript
describe('Events Idempotency', () => {
  test('same event_id processed once');
  test('different event_id processed separately');
  test('consumer handles duplicate gracefully');
});
```

### 4.5 Configuração de CI/CD

**`.github/workflows/test.yml`** (se usar GitHub Actions)
```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: pnpm test:coverage
```

### 4.6 Scripts de Teste

**`package.json` (adicionar)**
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

### 4.7 Critérios de Validação

- [ ] Todos os testes passam (`pnpm test`)
- [ ] Cobertura > 70% para módulos críticos
- [ ] Testes de idempotência passam
- [ ] Auth tests passam
- [ ] CI pipeline verde

---

## FASE 9.5 — HARDENING FINAL

> **Status: 🔄 PARCIAL**
>
> **✅ Implementado:**
> - Rate limiting via `@fastify/rate-limit` (100 req/min global, configurável)
> - Helmet (security headers)
> - CORS configurável
> - Dead-letter queue endpoint (`/admin/dead-letters`)
>
> **🔄 Em andamento:**
> - Monitoring/alerting de produção
>
> **⏳ Pendente:**
> - Webhook HMAC obrigatório em produção (atualmente opcional)
> - Logs estruturados JSON (atualmente console.log)
> - Load testing
> - Security audit (OWASP Top 10)

### 5.1 Objetivo (Original — Parcialmente Cumprido)

Endurecer o sistema para produção enterprise com segurança, observabilidade e resiliência.

### 5.2 Webhook Security Hardening (Pendente — Verificar necessidade de produção)

#### 5.2.1 Assinatura HMAC

**`packages/shared/src/webhook-guard.ts`** (atualizar)
```typescript
import { createHmac } from 'crypto';

interface WebhookGuardOptions {
  secret: string;
  signatureHeader: string;
  algorithm: 'sha256' | 'sha512';
}

export function createWebhookGuard(options: WebhookGuardOptions) {
  return function verifyWebhookSignature(
    payload: string,
    headers: Record<string, string | undefined>
  ): boolean {
    const signature = headers[options.signatureHeader];
    if (!signature) return false;

    const expected = createHmac(options.algorithm, options.secret)
      .update(payload)
      .digest('hex');

    // Comparação em tempo constante para evitar timing attacks
    return timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(`sha256=${expected}`)
    );
  };
}
```

**`modules/chat/src/presentation/http/webhook-inbound.controller.ts`**
```typescript
import { createWebhookGuard } from '@cvg/shared';

const verifySignature = createWebhookGuard({
  secret: process.env.WEBHOOK_SECRET!,
  signatureHeader: 'x-webhook-signature',
  algorithm: 'sha256',
});

app.post('/webhook/inbound', async (request, reply) => {
  const rawBody = JSON.stringify(request.body);
  const isValid = verifySignature(rawBody, request.headers as Record<string, string>);

  if (!isValid) {
    return reply.status(401).send({ error: 'INVALID_SIGNATURE' });
  }

  // ... resto do handler
});
```

#### 5.2.2 IP Allowlist (opcional)

```typescript
const ALLOWED_IPS = process.env.WEBHOOK_ALLOWED_IPS?.split(',') ?? [];

app.post('/webhook/inbound', {
  config: {
    rateLimit: {
      max: 1000, // mais permissivo para webhooks
      timeWindow: '1 minute',
    },
  },
}, async (request, reply) => {
  const clientIp = request.ip;

  if (ALLOWED_IPS.length > 0 && !ALLOWED_IPS.includes(clientIp)) {
    return reply.status(403).send({ error: 'IP_NOT_ALLOWED' });
  }

  // ... resto
});
```

### 5.3 Validação de Input Rigorosa

#### 5.3.1 Schemas Zod Refinados

**`modules/chat/src/presentation/http/webhook-inbound.controller.ts`**
```typescript
import { z } from 'zod';

const InboundMessageSchema = z.object({
  event_id: z.string().min(1).max(255),
  external_message_id: z.string().optional(),
  timestamp: z.string().datetime(),
  from: z.object({
    id: z.string().min(1),
    name: z.string().optional(),
  }),
  to: z.object({
    id: z.string().min(1),
  }),
  message: z.object({
    type: z.enum(['text', 'image', 'audio', 'video', 'document']),
    content: z.string().optional(),
    media_url: z.string().url().optional(),
  }),
});

app.post('/webhook/inbound', async (request, reply) => {
  const result = InboundMessageSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      error: 'INVALID_PAYLOAD',
      details: result.error.issues,
    });
  }

  // ... resto
});
```

### 5.4 Error Handling Refinado

#### 5.4.1 AppError Enhancement

**`packages/shared/src/error.ts`**
```typescript
export class AppError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
    public details?: Record<string, any>,
    public isOperational: boolean = true // false = programming error
  ) {
    super(code);
  }
}

// Erros pré-definidos
export const Errors = {
  NOT_FOUND: (entity: string) => new AppError(`${entity}_NOT_FOUND`, 404),
  UNAUTHORIZED: () => new AppError('UNAUTHORIZED', 401),
  FORBIDDEN: () => new AppError('FORBIDDEN', 403),
  VALIDATION: (details: any) => new AppError('VALIDATION_ERROR', 400, details),
  IDEMPOTENCY_CONFLICT: () => new AppError('IDEMPOTENCY_CONFLICT', 409),
  RATE_LIMITED: () => new AppError('RATE_LIMITED', 429),
  INTERNAL: () => new AppError('INTERNAL_ERROR', 500, undefined, false),
};
```

### 5.5 Logs Estruturados para Produção

**`apps/desk-api/src/index.ts`** (atualizar)
```typescript
const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    formatters: {
      level: (label) => ({ level: label }),
      bindings: (bindings) => ({
        service: 'desk-api',
        version: process.env.npm_package_version,
        ...bindings,
      }),
    },
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  },
});
```

**Exemplo de log:**
```json
{
  "level": "info",
  "service": "desk-api",
  "version": "1.0.0",
  "timestamp": "2026-04-09T12:00:00.000Z",
  "event": "message.persisted",
  "conversationId": "uuid",
  "messageId": "uuid",
  "correlationId": "uuid",
  "durationMs": 45
}
```

### 5.6 Rate Limiting por Endpoint

**`apps/desk-api/src/index.ts`**
```typescript
// Rate limit específico para endpoints críticos
app.post('/auth/login', {
  config: {
    rateLimit: {
      max: 5,
      timeWindow: '1 minute',
    },
  },
});

app.post('/webhook/inbound', {
  config: {
    rateLimit: {
      max: 1000,
      timeWindow: '1 minute',
    },
  },
});

app.post('/messages', {
  config: {
    rateLimit: {
      max: 60,
      timeWindow: '1 minute',
    },
  },
});
```

### 5.7 Dead Letter Queue UI

**`apps/desk-api/src/index.ts`** (já existe endpoint, adicionar UI em admin)

O endpoint `/admin/dead-letters` já existe. Adicionar UI em `pages/Admin.tsx` para visualização.

### 5.8 Critérios de Validação

- [ ] Webhook rejeita assinatura inválida
- [ ] Payload inválido retorna 400 com detalhes
- [ ] Rate limiting funciona por endpoint
- [ ] Logs são JSON estruturado
- [ ] Dead letter queue acessível via UI
- [ ] Timeout em chamadas externas (5s default)
- [ ] Retry com backoff em integrações

---

## RESUMO — CHECKLIST DE IMPLEMENTAÇÃO (Rebaselined 2026-04-09)

### Estado Atual

| Fase | Item | Status |
|------|------|--------|
| 9.1 | Realtime conectado ao frontend | ✅ IMPLEMENTADO |
| 9.2 | Secretary ativa no fluxo inbound | ✅ IMPLEMENTADO |
| 9.3 | Kanban drag-drop funcional | ✅ IMPLEMENTADO |
| 9.4 | Suite de testes > 70% cobertura | 🔄 EM ANDAMENTO |
| 9.5 | Webhook security + rate limiting | 🔄 PARCIAL |
| — | Load testing aprovado | ⏳ PENDENTE |
| — | Security audit (OWASP Top 10) | ⏳ PENDENTE |
| — | Backup strategy documentada | ⏳ PENDENTE |
| — | Runbook de operations criado | ⏳ PENDENTE |

### Métricas de Qualidade

| Métrica | Target | Atual |
|---------|--------|-------|
| Testes passando | 100% | ✅ (existem e passam) |
| Cobertura | > 70% | 🔄 (existe, limitada) |
| Rate limiting | ✅ | Implementado |
| Uptime | 99.9% | ⏳ pendente produção |
| Latência P99 | < 200ms | ⏳ pendente produção |
| Erros 5xx | < 0.1% | ⏳ pendente produção |

---

**Documento rebaselined:** 2026-04-09
**Próxima atualização:** Quando pendências forem resolvidas
