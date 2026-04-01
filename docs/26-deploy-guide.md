# Guia de Deploy — CVG Connect Desk

**Data:** 31/03/2026  
**Versão:** 1.0

## Pré-requisitos

- Docker 24+ e Docker Compose 2.20+
- 4GB RAM mínimo, 8GB recomendado
- PostgreSQL 16+
- Node.js 22+ (para desenvolvimento local)
- pnpm 10+

## Deploy com Docker

```bash
# 1. Clone e entre no diretório
git clone <repo-url> && cd connect_desk

# 2. Configure variáveis de ambiente
cp .env.example .env
# Edite .env com valores de produção

# 3. Build e start
docker compose up -d --build

# 4. Verifique saúde dos serviços
curl http://localhost:3000/health
curl http://localhost:3000/readiness
```

## Rollback

```bash
# 1. Liste imagens anteriores
docker images | grep connect-desk

# 2. Pare serviços atuais
docker compose down

# 3. Suba com imagem anterior
docker compose up -d --build --no-deps desk-api

# 4. Verifique
curl http://localhost:3000/health
```

## Checklist de Release

- [ ] `pnpm test` passa (20/20 tasks)
- [ ] `pnpm lint` passa (0 errors)
- [ ] `docker compose build` passa
- [ ] `docker compose up -d` sobe todos os serviços
- [ ] Health check retorna ok
- [ ] Readiness check retorna database: ok
- [ ] Login funciona
- [ ] Inbound webhook processa mensagens
- [ ] Outbound envia mensagens
- [ ] Realtime conecta e atualiza Inbox
- [ ] Dashboard exibe KPIs
- [ ] Audit registra ações
- [ ] Admin CRUD funciona

---

## Runbook Operacional

### Webhook falhando
1. Verifique `WEBHOOK_SECRET` configurado
2. Verifique logs: `docker compose logs desk-api | grep WebhookGuard`
3. Verifique rate limit: `docker compose logs desk-api | grep rate`

### Realtime desconectado
1. Verifique `VITE_REALTIME_URL` no frontend
2. Verifique `REALTIME_PORT` no backend
3. Verifique logs: `docker compose logs realtime-service`

### Worker parado
1. Verifique `docker compose logs message-worker`
2. Verifique conexão com banco
3. Reinicie: `docker compose restart message-worker`

### Secretary falhando
1. Verifique `SECRETARY_URL` e `SECRETARY_API_KEY`
2. Verifique logs: `docker compose logs desk-api | grep Secretary`
3. Verifique timeout: `SECRETARY_TIMEOUT_MS`

### Dead-letter queue
1. Acesse `GET /admin/dead-letters`
2. Identifique eventos falhando
3. Corrija causa raiz
4. Reenvie eventos manualmente se necessário
