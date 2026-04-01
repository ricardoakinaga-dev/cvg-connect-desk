# Troubleshooting Guide — CVG Connect Desk

**Versão:** 1.0  
**Data:** 01/04/2026

---

## 1. Realtime / WebSocket

### Problema: Inbox não atualiza em tempo real

**Verificar:**
1. Frontend conectado ao WebSocket?
   - Abrir DevTools > Network > WS
   - Verificar conexão `ws://localhost:8080`
2. Realtime service rodando?
   - `docker compose ps realtime-service`
3. Eventos sendo publicados?
   - `docker compose logs realtime-service | grep "project\|broadcast"`

**Causas comuns:**
- `VITE_REALTIME_URL` incorreto no `.env` do frontend
- Redis indisponível (usado pelo RedisEventBus)
- Realtime service não está projetando eventos (verificar `shouldProject()` em `@cvg/realtime`)

**Fallback:**
- Frontend faz polling automático a cada 60s se socket cair
- Reconexão automática com backoff de 5s

### Problema: Kanban não atualiza ao mover card

**Verificar:**
1. Evento `conversation.status.changed` sendo publicado?
   - `docker compose logs desk-api | grep "status.changed"`
2. Kanban subscribido ao evento?
   - Verificar `realtimeClient.subscribe('conversation.status.changed', ...)` em `Kanban.tsx`
3. Evento `conversation.assigned` sendo publicado?
   - Endpoint `/conversations/:id/assign` deve chamar `publishConversationAssigned()`

---

## 2. Webhook Inbound

### Problema: Mensagens inbound não chegam

**Verificar:**
1. Webhook secret configurado?
   - `WEBHOOK_SECRET` no `.env` deve bater com o gateway
2. Webhook guard passando?
   - `docker compose logs desk-api | grep WebhookGuard`
3. Evento `message.inbound.received` sendo criado?
   - `docker compose logs desk-api | grep "inbound"`
4. Mensagem sendo persistida?
   - `docker compose logs desk-api | grep "message.persisted"`

**Causas comuns:**
- Secret mismatch entre gateway e API
- Rate limiting ativado (verificar logs)
- Banco de dados indisponível

---

## 3. Outbound / Delivery

### Problema: Mensagens outbound não são enviadas

**Verificar:**
1. Gateway adapter configurado?
   - `GATEWAY_URL`, `GATEWAY_API_KEY` no `.env`
2. Evento `message.outbound.sent` registrado em audit?
   - `GET /audit/logs?action=message.outbound.sent`
3. Dead-letter queue com eventos de outbound?
   - `GET /admin/dead-letters`

**Causas comuns:**
- Gateway indisponível ou com credenciais inválidas
- Timeout na chamada ao gateway
- Telefone/JID incorreto no destinatário

---

## 4. Worker / Processamento Assíncrono

### Problema: Eventos não são processados pelo worker

**Verificar:**
1. Worker rodando?
   - `docker compose ps message-worker`
2. Poll interval configurado?
   - `WORKER_POLL_INTERVAL_MS` (default: 1000ms)
3. Eventos sendo publicados no `eventPublisher`?
   - Worker conserta via polling do `eventPublisher.getEvents()`
4. Dead-letter queue crescendo?
   - `GET /admin/dead-letters`

**Causas comuns:**
- Worker não está conectado ao mesmo `eventPublisher` que a API (processos separados)
- Redis indisponível (se usando RedisEventBus)
- Erros não tratados nos handlers

---

## 5. Secretary / Handoff

### Problema: Secretary não responde

**Verificar:**
1. `SECRETARY_URL` e `SECRETARY_API_KEY` configurados
2. Secretary health: `curl $SECRETARY_URL/health`
3. Logs de invocação: `docker compose logs message-worker | grep secretary`
4. Alertas gerados para falhas: `GET /metrics/alerts`

**Causas comuns:**
- Secretary service indisponível
- Timeout muito baixo (`SECRETARY_TIMEOUT_MS`)
- API key inválida

---

## 6. Audit / Observabilidade

### Problema: Audit logs não estão sendo registrados

**Verificar:**
1. `createAuditLog()` sendo chamado nos use-cases?
   - Verificar imports de `@cvg/audit`
2. Tabela `audit_logs` existe?
   - Migrations aplicadas: `npx drizzle-kit status`
3. Query de audit retorna dados?
   - `GET /audit/logs?limit=10`

### Problema: correlation_id não está sendo propagado

**Verificar:**
1. Event creators aceitam `correlationId`?
   - Sim, todos em `@cvg/events` aceitam
2. Gateway extrai `correlation_id` dos eventos inbound?
   - `gateway-normalizer.ts` linha 24
3. Audit logs recebem `correlationId`?
   - Verificar chamadas de `createAuditLog({ correlationId: ... })`

---

## 7. Dead-Letter Queue

### Problema: Muitos eventos na DLQ

**Verificar:**
1. Quais eventos estão falhando?
   - `GET /admin/dead-letters?resolved=false`
2. Qual o erro?
   - Campo `error` em cada entrada
3. Qual handler falhou?
   - Campo `handlerName`
4. Qual correlation_id?
   - Campo `correlationId` para trilhar o evento completo

**Ações:**
1. Corrigir causa raiz (ex: banco, timeout, validação)
2. Marcar como resolvido: `deadLetterStore.resolve(id)`
3. Nota: replay automático ainda não implementado

---

## 8. Banco de Dados

### Problema: Conexão com PostgreSQL falha

**Verificar:**
1. `DATABASE_URL` configurado corretamente
2. PostgreSQL rodando: `docker compose ps postgres`
3. Logs do banco: `docker compose logs postgres`
4. Readiness check: `curl http://localhost:3000/readiness`

### Problema: Migration falhou

**Verificar:**
1. Status das migrations: `npx drizzle-kit status`
2. Reverter: `npx drizzle-kit revert`
3. Verificar schema atual vs esperado
