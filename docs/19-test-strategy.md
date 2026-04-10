# Estratégia Mínima de Testes

## Smoke Tests Automáticos (Obrigatório)
Se o Gateway quebrar, toda a esteira do Hospital cai.

1. **Testes de Inbound Idempotente:** 
   O Worker envia o `{"id": "msg_xyz123", "text":"Oi"}` 4 vezes consecutivas. Só **UMA** mensagem pode aparecer no banco na mesma `conversation`.

2. **Testes de Handoff (Adapter):** 
   Se AI Secretary envia { "event": "agent.assign" }, o `api` precisa testar o endpoint validando que a permissão de Agent = "Human Receptionist" existe na `role` designada, ou joga Queue assignment error.
   Evidência atual: `modules/secretary-adapter/src/__tests__/invoke-secretary.integration.test.ts`, `modules/secretary-adapter/src/__tests__/trigger-handoff.integration.test.ts` e `modules/chat/src/__tests__/secretary-handoff.integration.test.ts`.

3. **Smoke browser do desk-web:**
   O Playwright mínimo sobe migrations, garante um usuário admin de smoke, faz login real, confirma Inbox, cria tarefa e abre Kanban.
   Evidência atual: `e2e/smoke/login-flow.test.ts`, `e2e/smoke/inbox-authenticated.test.ts`, `e2e/smoke/create-task.test.ts`, `e2e/smoke/kanban.test.ts`, `e2e/smoke/send-message.test.ts` (3 testes com fixture de conversa `ensureE2EConversation()` em `e2e/smoke/support.ts`).

4. **Suites PostgreSQL real em CI:**
   O GitHub Actions executa as suites mais valiosas que ainda dependem de PostgreSQL real antes do restante da cobertura ampla: `packages/events` real-db, `modules/chat` inbound idempotency e integrações críticas da `desk-api` como `auth`, `chat`, `events polling`, `webhook`, `kanban`, `labels`, `sectors`, `transfers`, `contacts` e `contact-groups`.
   O webhook inbound agora valida `reason` operacional explícito para rejeições de segurança, facilitando triagem sem inspeção manual de logs.
   O admin também expõe `GET /admin/dead-letters/stats` e `GET /admin/webhook-security/stats`, permitindo validar triagem agregada em vez de depender apenas de entradas individuais.
   Comando local equivalente: `pnpm test:postgres-real` após subir um PostgreSQL acessível e aplicar migrations. O script roda os arquivos-alvo diretamente com `vitest run`, evitando suites adjacentes do mesmo pacote.

5. **Testes locais de páginas do desk-web:**
   `Login`, `Inbox` e `Kanban` agora têm cobertura mínima com Vitest + React Testing Library em `apps/desk-web/src/__tests__/login.test.tsx`, `inbox.test.tsx` e `kanban.test.tsx`. O foco é validar submit/autenticação, carregamento e interação central com conversa e board, sem duplicar o smoke browser.

## Unidade
- Para `desk-api`: Jest ou Vitest testando as Service Layers sem acoplar com Express/Fastify request e Response.

## Integration / E2E
- Cobertura limitada, mas já existe setup mínimo de Playwright para smoke crítico.
- Para fluxos críticos que dependem de constraints, deduplicação e contratos HTTP, usar Fastify real com PostgreSQL migrado.
- Validar na borda HTTP as rotas de auth, chat, webhook, events polling e kanban quando o risco de regressão estiver na API e não apenas no use case.
- Para realtime auth, preferir WebSocket real com auth server local ou harness equivalente.
- CI: `.github/workflows/smoke-e2e.yml` executa `pnpm test:e2e:smoke` em push e PR, com artifacts de trace em falha.
- CI: `.github/workflows/postgres-real-tests.yml` executa `pnpm test:postgres-real` em push e PR, com PostgreSQL service container dedicado.
