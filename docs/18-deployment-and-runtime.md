# Deployment e Runtime

## 1. Estado Atual dos Runtimes
No estado atual do monorepo (01/04/2026), os seguintes runtimes estão implementados e operacionais:
- `apps/desk-api` - API Fastify com rotas de chat, tasks, notes, alerts, dashboard, audit e auth
- `apps/desk-web` - Frontend React/Vite (operacional com auth real, KPIs premium, realtime)
- `apps/message-worker` - Worker para processamento assíncrono de eventos (com retry → DLQ wiring)
- `apps/realtime-service` - Servidor WebSocket para realtime (conectado ao frontend, projeta eventos)

## 2. Runtimes e Suas Responsabilidades

### 2.1 desk-api (API)
**Responsabilidade**: Servir como fonte primária de estado operacional, processar requests HTTP, gerenciar autenticação e autorização, publicar eventos.

**Porta padrão**: 3000

**Health check**: GET `/health` - Retorna status básico do serviço

**Readiness check**: GET `/readiness` - Verifica conectividade com banco de dados e Redis

**Dependências**:
- PostgreSQL (obrigatório)
- Redis (obrigatório para RedisEventBus)

### 2.2 desk-web (Frontend)
**Responsabilidade**: Interface operacional para atendentes e gestores, consumir API, exibir dados, KPIs premium, realtime.

**Porta padrão**: 5173 (dev), build para produção

**Build**: `pnpm build` gera assets estáticos em `dist/`

**Dependências**:
- API (desk-api) para funcionamento

### 2.3 message-worker (Worker)
**Responsabilidade**: Processar eventos assíncronos, executar handlers secundários (alertas derivados de handoff, falhas de Secretary).

**Dependências**:
- PostgreSQL (obrigatório)
- Event publisher do desk-api

### 2.4 realtime-service (WebSocket)
**Responsabilidade**: Manter conexões WebSocket com clientes, projetar eventos para realtime.

**Porta padrão**: 3001

**Status**: Implementado, não conectado ao frontend (fallback por polling ativo)

## 3. Infra-Agonistic (EasyPanel / Docker)
Não faremos dependência de Vercel/Netlify se a clínica preza pela Cloud Local (ou Nuvem VPS com EasyPanel). Todo App `apps/desk-api` e `apps/desk-web` tem que ter `Dockerfile` multistage compatível com `alpine-linux` e port mapping direto.

## 4. Variáveis de Ambiente (Configuração de Ambiente)

### Obrigatórias:
- `PORT` (API, ex: 3000)
- `DATABASE_URL` (Supabase, Neon, Local PostgreSQL)

### Frontend:
- `VITE_API_URL` (URL da API, ex: http://localhost:3000)

### Opcionais:
- `REDIS_URL` (Redis Cloud, Redis Local)
- `GATEWAY_URL` (url do serviço externo pre-existente)
- `WORKER_POLL_INTERVAL_MS` (Intervalo de polling do worker, default: 5000)
- `REALTIME_PORT` (Porta do servidor WebSocket, default: 3001)
- `REALTIME_POLL_INTERVAL_MS` (Intervalo de polling de eventos, default: 1000)
- `SECRETARY_API_KEY` (Chave da API Secretary)
- `SECRETARY_URL` (URL do serviço Secretary)

## 5. Inicialização em Desenvolvimento

```bash
# Instalar dependências
pnpm install

# Iniciar API
cd apps/desk-api && pnpm dev

# Iniciar Frontend
cd apps/desk-web && pnpm dev

# Iniciar Worker (em outro terminal)
cd apps/message-worker && pnpm dev

# Iniciar Realtime (em outro terminal)
cd apps/realtime-service && pnpm dev
```

## 6. Build de Produção

```bash
# Build de todos os apps
pnpm build

# O output será gerado em cada app:
# - apps/desk-api/dist (se configurado)
# - apps/desk-web/dist (assets estáticos)
```

## 7. Health e Readiness

### Health (`GET /health`)
Retorna status básico do serviço. Usado para liveness probe.

```json
{
  "status": "ok",
  "timestamp": "2026-03-29T12:00:00.000Z"
}
```

### Readiness (`GET /readiness`)
Verifica dependências críticas. Usado para readiness probe.

```json
{
  "ready": true,
  "checks": {
    "database": { "status": "ok" }
  }
}
```

## 8. Dependências Críticas para Produção

Antes de colocar em produção, os seguintes itens devem ser configurados:
- Banco de dados PostgreSQL configurado e acessível
- Variáveis de ambiente properly configuradas (sem valores hardcoded)
- Credenciais da Secretary (se integrada)
- SSL/TLS configurado (recomendado)
- Rate limiting implementado (não implementado atualmente)
- Monitoring/basic alerting (não implementado atualmente)

## 9. Limitações Atuais

- Rate limiting ainda não implementado
- Monitoring/alerting de produção não implementado
- Realtime service não conectado ao frontend (fallback por polling ativo)
- Webhook security precisa de endurecimento adicional
