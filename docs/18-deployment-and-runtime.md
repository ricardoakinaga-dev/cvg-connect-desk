# Deployment e Runtime

> **Status do Documento:** ATUALIZADO EM 2026-04-10
>
> Este documento foi revisado e corrigido para refletir o estado real do código.
> Divergências anteriores: porta do realtime (3001 → 8080), rate limiting ("não implementado" → implementado),
> realtime ("não conectado" → conectado ao frontend).

## 1. Estado Atual dos Runtimes
No estado atual do monorepo, os seguintes runtimes estão implementados e operacionais:
- `apps/desk-api` - API Fastify com rotas de chat, tasks, notes, alerts, dashboard e auth
- `apps/desk-web` - Frontend React/Vite (operacional com auth real e realtime)
- `apps/message-worker` - Worker para processamento assíncrono de eventos
- `apps/realtime-service` - Servidor WebSocket para realtime (implementado e conectado ao frontend)

## 2. Runtimes e Suas Responsabilidades

### 2.1 desk-api (API)
**Responsabilidade**: Servir como fonte primária de estado operacional, processar requests HTTP, gerenciar autenticação e autorização, publicar eventos.

**Porta padrão**: 3000

**Health check**: GET `/health` - Retorna status básico do serviço

**Readiness check**: GET `/readiness` - Verifica conectividade com banco de dados

**Dependências**:
- PostgreSQL (obrigatório)
- Redis (opcional, para sessão se desejado)

### 2.2 desk-web (Frontend)
**Responsabilidade**: Interface operacional para atendentes e gestores, consumir API, exibir dados.

**Porta padrão**: 5173 (dev), build para produção

**Build**: `pnpm build` gera assets estáticos em `dist/`

**Dependências**:
- API (desk-api) para funcionamento
- Admin inclui a aba `Dead-letter`, que consome `/admin/dead-letters` e expõe `retry` contextual ou `resolve` manual

### 2.3 message-worker (Worker)
**Responsabilidade**: Processar eventos assíncronos, executar handlers secundários (alertas derivados de handoff, falhas de Secretary).

**Dependências**:
- PostgreSQL (obrigatório)
- Event publisher do desk-api

**Observabilidade operacional**: as falhas terminais registradas pelo worker carregam `failureContext` estruturado na dead-letter, incluindo handler, decisão, retry count e `reason` operacional para triagem no admin.
**Superfície operacional mínima**: o admin expõe `/admin/dead-letters/stats` para resumo agregado da DLQ e `/admin/webhook-security/stats` para contagem dos `reason` de bloqueio do webhook. Esses resumos são process-local/in-memory e servem para triagem operacional no processo atual, não para retenção histórica.

### 2.4 realtime-service (WebSocket)
**Responsabilidade**: Manter conexões WebSocket com clientes, projetar eventos para realtime.

**Porta padrão**: 8080

**Status**: Implementado e conectado ao frontend via WebSocket. O Inbox utiliza realtime para atualizações em tempo real com polling de fallback configurável e autenticação por mensagem com token.

## 3. Infra-Agonistic (EasyPanel / Docker)
Não faremos dependência de Vercel/Netlify se a clínica preza pela Cloud Local (ou Nuvem VPS com EasyPanel). Todo App `apps/desk-api` e `apps/desk-web` tem que ter `Dockerfile` multistage compatível com `alpine-linux` e port mapping direto.

## 4. Variáveis de Ambiente (Configuração de Ambiente)

### Obrigatórias:
- `PORT` (API, ex: 3000)
- `DATABASE_URL` (Supabase, Neon, Local PostgreSQL)

### Frontend:
- `VITE_API_URL` (URL da API, ex: http://localhost:3000)
- `VITE_REALTIME_URL` (URL do websocket realtime, ex: ws://localhost:8080)

### Opcionais:
- `REDIS_URL` (Redis Cloud, Redis Local)
- `GATEWAY_URL` (url do serviço externo pre-existente)
- `WORKER_POLL_INTERVAL_MS` (Intervalo de polling do worker, default: 5000)
- `REALTIME_PORT` (Porta do servidor WebSocket, default: 8080)
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
- Rate limiting implementado (via @fastify/rate-limit, configurável via `RATE_LIMIT_MAX` e `RATE_LIMIT_WINDOW`)
- Monitoring/basic alerting (não implementado atualmente)

## 9. Limitações Atuais

> **Nota:** As limitações listadas aqui foram revalidadas em 2026-04-10.

- Monitoring/alerting de produção não implementado
- Pipeline de eventos utiliza publisher in-memory (não é ainda interprocesso real em múltiplas máquinas)
- Autenticação do canal realtime no cliente principal usa message-based auth com token no payload; o servidor ainda mantém compatibilidade legada com `?token=<jwt>` para clientes antigos
- Webhook security: fail-secure em produção (WEBHOOK_SECRET obrigatório), bypass com warning em dev. A API emite erro em stderr no bootstrap se NODE_ENV=production e WEBHOOK_SECRET ausente. Respostas de falha expõem `reason` operacional (`missing_secret`, `missing_signature`, `invalid_signature_format`, `invalid_signature`) para triagem mais rápida. Configuração de produção: `NODE_ENV=production` ou `DESK_ENV=production`
- Webhook security: além das respostas e logs com `reason`, o admin agrega os bloqueios em `/admin/webhook-security/stats`, reduzindo dependência de inspeção manual de eventos individuais.
- O guard de webhook agora tem fonte única em `packages/shared/src/webhook-guard.ts`; a cópia manual `webhook-guard.js` foi removida para reduzir drift de manutenção.
- Dead-letter admin UI existe; o `message-worker` grava automaticamente `sourceEvent` nas falhas terminais cobertas, além de `failureContext` estruturado com handler, decisão, retry count e motivo operacional, permitindo `retry` contextual no admin. O `realtime-service` foi auditado e não entra no mesmo padrão replayável porque eventos não projetáveis são apenas ackados/ignorados. Entradas legadas ou sem envelope continuam usando `resolve` manual
- Dead-letter admin UI também consome `/admin/dead-letters/stats` para mostrar replayáveis, manuais e motivos principais sem abrir cada entrada
- Smoke Playwright usa portas isoladas (`4330`/`4930`/`4173`) e `VITE_API_URL=http://localhost:4330` / `VITE_REALTIME_URL=ws://localhost:4930`; o banco do smoke fica em `localhost:55432` e o Redis em `localhost:56379`
