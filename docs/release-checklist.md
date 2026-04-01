# Checklist de Release — CVG Connect Desk

**Versão:** 1.0  
**Data:** 01/04/2026  
**Status:** ✅ Pronto para uso

---

## Pré-Release

### Código
- [ ] `pnpm install --frozen-lockfile` passa
- [ ] `pnpm lint` passa (0 errors)
- [ ] `pnpm typecheck` passa (máx. erros aceitáveis: módulo admin não-crítico)
- [ ] `pnpm test` passa (todos os testes)
- [ ] Nenhum `console.log` de debug deixado no código
- [ ] Nenhum `TODO` ou `FIXME` crítico sem issue associada
- [ ] Branch atualizada com main

### Build
- [ ] `turbo run build` passa sem erros
- [ ] `docker compose build` passa
- [ ] Imagens Docker geradas com sucesso

### Infraestrutura
- [ ] PostgreSQL rodando e acessível
- [ ] Redis rodando e acessível
- [ ] Migrations aplicadas (`npx drizzle-kit push` ou equivalente)
- [ ] `.env` configurado com valores corretos

---

## Deploy

### Serviços
- [ ] `docker compose up -d` sobe todos os serviços
- [ ] `docker compose ps` mostra todos os serviços `healthy` ou `running`

### Health Checks
- [ ] `GET http://localhost:3000/health` → 200 OK
- [ ] `GET http://localhost:3000/readiness` → 200 OK (db: ok, redis: ok)
- [ ] `GET http://localhost:8080/health` → 200 OK

### Funcionalidades Críticas
- [ ] Login funciona (email + senha válidos)
- [ ] Logout funciona
- [ ] Inbox carrega conversas
- [ ] Mensagem inbound é recebida e exibida
- [ ] Mensagem outbound é enviada
- [ ] Realtime conecta (WebSocket em `ws://localhost:8080`)
- [ ] Inbox atualiza em tempo real sem refresh
- [ ] Kanban carrega e atualiza em tempo real
- [ ] Dashboard exibe KPIs (mínimo 6)
- [ ] Conversation Aging é exibido no Dashboard
- [ ] Alertas por criticidade são exibidos
- [ ] Backlog por setor é exibido

### Audit e Observabilidade
- [ ] `GET /audit/logs` retorna dados
- [ ] `GET /audit/conversation/:id` retorna timeline
- [ ] `GET /audit/correlation/:id` retorna trilha
- [ ] `GET /admin/dead-letters` retorna dados
- [ ] Eventos de login são registrados em audit
- [ ] Eventos de mensagem são registrados em audit
- [ ] correlation_id é propagado nos eventos

### Realtime
- [ ] `conversation.status.changed` é projetado e broadcast
- [ ] `conversation.assigned` é projetado e broadcast
- [ ] `message.persisted` é projetado e broadcast
- [ ] `conversation.created` é projetado e broadcast
- [ ] Frontend recebe eventos em < 1s
- [ ] Fallback de polling funciona se socket cair

### Worker
- [ ] Worker processa `handoff.completed`
- [ ] Worker processa `secretary.invocation`
- [ ] Worker processa `message.persisted`
- [ ] Retry com exponential backoff funciona
- [ ] Dead-letter queue recebe eventos após max retries

---

## Pós-Release

### Monitoramento
- [ ] Logs estão sendo gerados (pino JSON em produção)
- [ ] Dead-letter queue está vazia ou com < 10 eventos
- [ ] Latência API -> Realtime p95 < 1s
- [ ] Nenhum erro 5xx nos últimos 5 minutos

### Documentação
- [ ] CHANGELOG atualizado
- [ ] Tag git criada (`git tag v<version>`)
- [ ] Docs de deploy atualizados se necessário
- [ ] Runbook operacional acessível pela equipe

### Comunicação
- [ ] Equipe notificada do deploy
- [ ] Operadores de plantão informados
- [ ] Canal de incidentes configurado

---

## Rollback (se necessário)

- [ ] Identificar versão anterior estável
- [ ] `docker compose down`
- [ ] `git checkout <tag-anterior>`
- [ ] `docker compose up -d --build`
- [ ] Validar health endpoints
- [ ] Verificar logs por erros
- [ ] Notificar equipe do rollback

---

**Checklist executado por:** _________________  
**Data:** _________________  
**Versão deployada:** _________________
