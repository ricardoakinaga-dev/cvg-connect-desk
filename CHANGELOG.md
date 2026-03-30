# Changelog

## [1.0.0] — 2026-03-30

### ✅ Fase 8 — Refinement & Deployment (Enterprise)

**Segurança:**
- Middleware de validação HMAC para webhook inbound (`WEBHOOK_SECRET`)
- `@fastify/helmet` para security headers
- CORS configurável via `CORS_ORIGIN`
- Rate limiting global com headers de resposta
- Usuário non-root nos containers Docker

**Infraestrutura:**
- Dockerfiles multistage para todos os serviços (API, Worker, Realtime, Frontend)
- `docker-compose.yml` produção com build de imagens, health checks e networking isolado
- `docker-compose.dev.yml` para desenvolvimento com hot-reload
- `.dockerignore` para builds otimizados
- Redis com persistência e eviction policy

**Observabilidade:**
- Logs estruturados com pino (JSON em produção, pretty em dev)
- Error handler global padronizado
- Health check aprimorado com uptime e versão
- Readiness check com latência de banco
- Dead-letter queue para eventos falhados
- Endpoint `/admin/dead-letters` para monitoramento

**API:**
- Swagger/OpenAPI completo com tags e security schemes
- Error handler global com stack trace em dev
- Body limit de 1MB
- Graceful shutdown (SIGINT/SIGTERM)
- Trust proxy configurado

**Qualidade:**
- Vitest configurado com testes para shared, events
- Testes de pagination, Result pattern, AppError, DeadLetterStore
- Utilitário de paginação reutilizável

**Documentação:**
- README.md enterprise com arquitetura, endpoints, setup
- `.env.example` completo com todas as variáveis documentadas
- nginx.conf com security headers, gzip e cache de assets

### Fases Anteriores (0–7)

- Foundation, Core Chat, Operations, Secretary, Events+Worker, Realtime, Dashboard, Frontend MVP
- Auth real com RBAC, Audit trail, Admin CRUD
- See [docs/20-master-execution-log.md](./docs/20-master-execution-log.md) for details
