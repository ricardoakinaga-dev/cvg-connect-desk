# Runbook Operacional — CVG Connect Desk

**Versão:** 1.0  
**Data:** 01/04/2026  
**Status:** ✅ Atualizado com estado real do código

---

## 1. Visão Geral dos Serviços

| Serviço | Porta | Health Endpoint | Log Command |
|---|---|---|---|
| `desk-api` | 3000 | `GET /health`, `GET /readiness` | `docker compose logs -f desk-api` |
| `realtime-service` | 8080 | `GET /health` | `docker compose logs -f realtime-service` |
| `message-worker` | — | N/A (sem HTTP) | `docker compose logs -f message-worker` |
| `desk-web` | 5173 | N/A (frontend) | `docker compose logs -f desk-web` |
| `postgres` | 5432 | N/A | `docker compose logs -f postgres` |
| `redis` | 6379 | N/A | `docker compose logs -f redis` |

---

## 2. Procedimentos de Incidente

### 2.1. API Principal (desk-api) indisponível

**Sintomas:**
- `GET /health` retorna erro ou timeout
- Frontend mostra erros de conexão
- Webhook do gateway falha

**Diagnóstico:**
```bash
# Verificar se o container está rodando
docker compose ps desk-api

# Verificar logs recentes
docker compose logs --tail=100 desk-api

# Verificar conexão com banco
docker compose exec desk-api node -e "fetch('http://localhost:3000/readiness').then(r => r.json()).then(console.log)"
```

**Ações:**
1. Se OOM: aumentar memória no `docker-compose.yml` (`deploy.resources.limits.memory`)
2. Se banco indisponível: verificar `docker compose ps postgres` e logs
3. Se Redis indisponível: verificar `docker compose ps redis`
4. Restart: `docker compose restart desk-api`
5. Se persistir: rollback para versão anterior

### 2.2. Realtime desconectado

**Sintomas:**
- Inbox não atualiza em tempo real
- Kanban não reflete mudanças sem refresh
- Dashboard não atualiza automaticamente

**Diagnóstico:**
```bash
# Verificar serviço realtime
docker compose ps realtime-service
docker compose logs --tail=50 realtime-service

# Verificar conexão Redis (usado pelo RedisEventBus)
docker compose exec redis redis-cli ping

# Testar WebSocket
wscat -c ws://localhost:8080
```

**Ações:**
1. Verificar `REDIS_URL` configurado corretamente
2. Verificar `REALTIME_URL` no frontend (`.env`)
3. Se Redis caiu: `docker compose restart redis`
4. Se realtime caiu: `docker compose restart realtime-service`
5. Frontend tem fallback automático para polling (60s)

### 2.3. Worker parado ou com erros

**Sintomas:**
- Eventos não são processados assincronamente
- Handoff não gera alertas
- Secretary invocations não são tratadas

**Diagnóstico:**
```bash
docker compose ps message-worker
docker compose logs --tail=100 message-worker

# Verificar dead-letter queue
curl http://localhost:3000/admin/dead-letters
```

**Ações:**
1. Se worker caiu: `docker compose restart message-worker`
2. Se há dead-letters: investigar causa raiz nos logs
3. Verificar `WORKER_POLL_INTERVAL_MS` (default: 1000ms)
4. Se eventos acumulando: verificar se `eventPublisher` está sendo consumido

### 2.4. Webhook do Gateway falhando

**Sintomas:**
- Mensagens inbound não chegam na Inbox
- Gateway retorna erro ao enviar webhook

**Diagnóstico:**
```bash
# Verificar logs de webhook
docker compose logs desk-api | grep -i webhook

# Verificar webhook guard
docker compose logs desk-api | grep -i "WebhookGuard"

# Verificar se endpoint está acessível
curl -X POST http://localhost:3000/webhook/evolution \
  -H "Content-Type: application/json" \
  -d '{"event": "test"}'
```

**Ações:**
1. Verificar `WEBHOOK_SECRET` configurado e batendo com o gateway
2. Verificar se `@cvg/shared/webhook-guard` está validando corretamente
3. Verificar rate limiting nos logs
4. Se gateway externo: verificar conectividade de rede

### 2.5. Secretary falhando

**Sintomas:**
- Secretary não responde a invocações
- Alertas de falha na secretary são gerados

**Diagnóstico:**
```bash
docker compose logs desk-api | grep -i secretary
docker compose logs message-worker | grep -i secretary
```

**Ações:**
1. Verificar `SECRETARY_URL` e `SECRETARY_API_KEY`
2. Verificar timeout: `SECRETARY_TIMEOUT_MS` (default: 30000)
3. Verificar se secretary está respondendo: `curl $SECRETARY_URL/health`
4. Eventos de falha são registrados em audit e geram alertas automaticamente

### 2.6. Dead-letter Queue crescendo

**Sintomas:**
- Muitos eventos na dead-letter queue
- Eventos críticos não sendo processados

**Diagnóstico:**
```bash
# Verificar dead-letters
curl http://localhost:3000/admin/dead-letters | jq '.stats'
curl http://localhost:3000/admin/dead-letters?resolved=false | jq '.data | length'
```

**Ações:**
1. Identificar padrão nos eventos falhando (mesmo `event_type`?)
2. Verificar logs do worker para erros específicos
3. Corrigir causa raiz (ex: banco indisponível, timeout)
4. Após correção, dead-letters podem ser resolvidos via `resolve()` (marcar como tratado)
5. Nota: replay automático ainda não implementado — reprocessar eventos manualmente se necessário

---

## 3. Procedimento de Rollback

### 3.1. Rollback via Docker

```bash
# 1. Identificar versão estável anterior
git tag -l | sort -V | tail -5

# 2. Parar serviços atuais
docker compose down

# 3. Checkout da versão anterior
git checkout <tag-anterior>

# 4. Rebuild e start
docker compose up -d --build

# 5. Validar
curl http://localhost:3000/health
curl http://localhost:3000/readiness
docker compose logs -f
```

### 3.2. Rollback de banco de dados

Se migration causou problema:
```bash
# Verificar migrations aplicadas
docker compose exec desk-api npx drizzle-kit status

# Reverter última migration (se suportado)
docker compose exec desk-api npx drizzle-kit revert
```

### 3.3. Rollback parcial (apenas um serviço)

```bash
# Rollback apenas da API
docker compose down desk-api
git checkout <tag-anterior> -- apps/desk-api/ packages/
docker compose up -d --build desk-api
```

---

## 4. Monitoramento e Alertas

### 4.1. Endpoints de Monitoramento

| Endpoint | Descrição | Esperado |
|---|---|---|
| `GET /health` | Status básico | 200 OK |
| `GET /readiness` | Dependências | 200 OK (db: ok, redis: ok) |
| `GET /admin/dead-letters` | Dead-letter queue | `{ data: [], stats: {...} }` |
| `GET /audit/logs?limit=10` | Audit logs recentes | Array de logs |

### 4.2. Logs Estruturados

- API: Pino (JSON em produção, pretty em dev)
- Worker: console.log (migração para pino planejada)
- Realtime: console.log

### 4.3. Métricas Importantes

- Latência API -> Realtime: p95 < 1s
- Dead-letter queue size: < 10 eventos não resolvidos
- Worker retry rate: < 5% dos eventos
- Realtime disconnect rate: < 1% das sessões/hora

---

## 5. Escalação

| Nível | Responsável | Quando acionar |
|---|---|---|
| L1 — Suporte | Operador de plantão | Incidentes básicos (restart de serviço) |
| L2 — Engenharia | Dev responsável | Bugs, dead-letter persistente, dados inconsistentes |
| L3 — Arquitetura | Tech Lead | Problemas de arquitetura, performance, segurança |
