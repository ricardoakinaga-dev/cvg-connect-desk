# Gaps Técnicos — CVG Connect Desk

**Documento:** Consolidado de Gaps Técnicos
**Data de revisão:** 2026-04-10
**Baseado em:** Análise de código + relatórios 26, 27, 29 + Plans 66, 68
**Status:** Este documento é a referência central de pendências técnicas reais
**Fase 2 (Observabilidade e Governança):** ENCERRADA ✅

---

## 1. Objetivo

Este documento concentra, de forma consolidada e atualizada, os gaps técnicos reais remanescentes do projeto CVG Connect Desk. Ele substitui a leitura分散ada de múltiplos relatórios e auditorias para dar uma visão executiva clara do que ainda precisa ser tratado.

---

## 2. Definição de "Gap Técnico Real"

Um gap técnico real é uma limitaação que:

1. **Está presente no código atual** — não apenas na documentação
2. **Impacta operação, segurança ou escalabilidade** — não é meramentecosmético
3. **Não foi resolvido intencionalmente** como trade-off consciente
4. **Requer trabalho de engenharia** para ser mitigado

**Não são gaps:**
- Divergências documentais já corrigidas
- Features planejadas mas não prometidas
- Melhorias desejáveis sem impacto operacional imediato

---

## 3. Itens Já Resolvidos (Não São Mais Gaps Abertos)

Os seguintes items foram **mitigados ou resolvidos** e não devem ser tratados como pendências:

| Item | Era | Agora | Evidência |
|------|-----|-------|-----------|
| Realtime autenticação fraca | userId aceito do cliente sem validação | Validação via `/auth/me` antes de permitir operações | `apps/realtime-service/src/index.ts:156-174` |
| Webhook HMAC opcional | Ignorado se `WEBHOOK_SECRET` ausente | Fail-secure: rejeita com 500 em produção + bootstrap warning | `packages/shared/src/webhook-guard.ts`, `apps/desk-api/src/app.ts:30-35` |
| Rate limiting ausente | Afirmado como não implementado | Implementado via `@fastify/rate-limit` | `apps/desk-api/src/index.ts:96` |
| Realtime conectado no cliente principal | Frontend usava polling | `realtimeClient.connect()` com subscriptions reativas no Inbox | `apps/desk-web/src/pages/Inbox.tsx:57-98` |
| Secretary não integrada | Adapter existia mas não era chamado | `processMessageWithSecretary()` no fluxo inbound | `modules/chat/.../receive-inbound-message.use-case.ts:150` |
| Kanban move não implementado | Afirmado como não verificado | `PATCH /kanban/card/:id/move` existe | `modules/kanban/.../kanban.controller.ts:89` |
| Testes ausentes | "Zero implementação" | 27 packages com testes passando | `pnpm test` executa com sucesso |
| Pipeline de eventos in-memory | API publica em memória, workers não recebem | Eventos publicados no banco via `outbox_events` | `packages/events/src/outbox-publisher.ts` |
| Fan-out por consumer | Consumidores compartilhavam `processedAt` | Cada consumer tem `outboxConsumerAcks` | `packages/events/src/outbox-reader.ts` |
| Retry semântico por consumer | Falha fazia DELETE de ack, perdia histórico | Falha faz UPSERT, mantém `retryCount` e `lastError` | `packages/events/src/outbox-reader.ts` |
| Versionamento explícito do envelope | `version` não distinguia contrato e aggregate | `event_version` explícito no envelope e persistido no outbox | `packages/events/src/envelope.ts`, `packages/events/src/outbox-publisher.ts`, `packages/events/src/outbox-reader.ts`, `packages/database/src/schema.ts` |

> **Nota:** Os relatórios 26 e 27 continham claims que foram posteriormente superados pelo código. O relatório 29 confirmou que realtime auth e webhook security estão funcionais.

---

## 4. Gaps Remanescentes

### G-01: Pipeline de Eventos — MITIGADO

| Campo | Detalhe |
|-------|---------|
| **Nome** | Pipeline de eventos agora é distribuído via banco |
| **Descrição** | O sistema agora usa `outbox_events` no banco + `outboxConsumerAcks` para fan-out seguro. O publisher escreve no banco; cada consumer (worker, realtime, http-poll) tem seu próprio ack e retry tracking. |
| **Evidência no código** | `packages/events/src/outbox-publisher.ts` — `DatabaseEventPublisher`; `packages/events/src/outbox-reader.ts` — `ConsumerAwareOutboxReader`; `packages/database/supabase/migrations/0011_outbox_consumer_acks.sql` — schema |
| **Evidência comportamental** | 21 testes comportamentais reais executados com PostgreSQL: 8 em `outbox-fanout-behavioral.test.ts` + 13 em `outbox-reader-real.test.ts` (classe `ConsumerAwareOutboxReader` real via helper compartilhado e cliente PostgreSQL direto). Valida: fan-out para múltiplos consumers, ack isolado por consumer, retry semântico, falha permanente não bloqueia outro consumer, sucesso fecha apenas o consumer. A execução dedicada fica em `packages/events/package.json:test:real-db`. |
| **Impacto** | Worker e realtime processam eventos da API de forma independente. Produção distribuída é viável. |
| **Severidade** | 🟢 Baixo (mitigado) |
| **Status** | Implementado e testado com evidência comportamental real da classe (124 testes no package events, incluindo 13 testes diretos do ConsumerAwareOutboxReader contra PostgreSQL real) |
| **Recomendação** | Verificar se migration foi aplicada; em caso de dúvidas, aplicar manualmente |
| **Correção aplicada** | `acknowledge()` foi corrigido para usar `onConflictDoUpdate` em vez de `onConflictDoNothing`, garantindo que sucesso sobrescreve falha anterior corretamente |

---

### G-02: Autenticação Realtime Sem Revalidação Periódica

| Campo | Detalhe |
|-------|---------|
| **Nome** | Token não é revalidado durante sessões longas |
| **Descrição** | O token JWT era validado apenas no handshake WebSocket via chamada a `/auth/me`. Agora o servidor revalida periodicamente o token durante conexões longas. |
| **Evidência no código** | `apps/realtime-service/src/index.ts:308-384` — `startRevalidationTimer`, `revalidateToken`, `handleRevalidationFailure`; `REALTIME_AUTH_REVALIDATE_MS` configurável (default 5min) |
| **Impacto** | Revogação de token agora é detectada em até `REALTIME_AUTH_REVALIDATE_MS` após a revogação. Conexão é fechada com código 4002 e evento `auth.revalidate.error`. |
| **Severidade** | 🟡 Médio |
| **Status** | **MITIGADO** — Implementado com revalidação periódica configurável |
| **Testes** | 32 testes em `realtime-revalidation.test.ts` cobrindo: configuração de intervalo, timer cleanup, failure handling, message-based auth (G-03), backward compatibility |
| **Recomendação** | Ajustar `REALTIME_AUTH_REVALIDATE_MS` conforme política de segurança — intervalos menores = detecção mais rápida de sessões revoked, mas mais chamadas à API |

---

### G-03: Token Exposto na URL do WebSocket

| Campo | Detalhe |
|-------|---------|
| **Nome** | JWT passado em query string |
| **Descrição** | O token era passado na URL do WebSocket (`ws://host?token=<jwt>`). Agora o servidor suporta autenticação via mensagem (`{type: 'auth', token: '<jwt>'}`), permitindo que o cliente envie o token pelo corpo da mensagem em vez da URL. |
| **Evidência no código** | `apps/desk-web/src/lib/realtime.ts` — cliente principal abre sem query string e envia `{type: 'auth', token}`; `apps/desk-web/src/pages/Inbox.tsx` — Inbox usa o fluxo novo; `apps/realtime-service/src/index.ts:281-299` — message-based auth handler; `apps/realtime-service/src/index.ts:64-72` — `extractTokenFromUrl` (compatibilidade legada apenas no servidor) |
| **Impacto** | O `desk-web` principal não expõe mais o token na URL. A compatibilidade por query string continua disponível apenas para clientes legados. Produção deve usar wss:// (TLS). |
| **Severidade** | 🟡 Médio |
| **Status** | **PRONTO** — o `desk-web` principal migrou para message-based auth com token fora da URL |
| **Recomendação** | (1) Production: sempre usar wss://; (2) Manter `extractTokenFromUrl` somente enquanto houver clientes legados; (3) Remover o fallback quando não houver dependências remanescentes |
| **Trade-off** | A compatibilidade por URL permanece no servidor para não quebrar clientes antigos, mas não é mais o fluxo padrão do sistema. |

---

### G-04: Webhook HMAC Opcional em Desenvolvimento — REDUZIDO

| Campo | Detalhe |
|-------|---------|
| **Nome** | Webhook fail-secure em produção, bypass documentado em dev |
| **Descrição** | Produção sem `WEBHOOK_SECRET`: 500 `CONFIGURATION_ERROR` via `webhook-guard.ts`. Desenvolvimento sem `WEBHOOK_SECRET`: warning log + bypass (comportamento DX intencional). Bootstrap da API emite erro em stderr se `NODE_ENV=production` ou `DESK_ENV=production` sem `WEBHOOK_SECRET`. |
| **Evidência no código** | `packages/shared/src/webhook-guard.ts` (fail-secure per-request); `apps/desk-api/src/app.ts:30-35` (bootstrap warning); `apps/desk-api/src/__tests__/webhook-inbound.integration.test.ts` (testes de produção e dev) |
| **Impacto** | O bypass em dev é intencional para DX. Deploy sem `WEBHOOK_SECRET` em produção é bloqueado por 500 e por erro em stderr no bootstrap. |
| **Severidade** | 🟢 Baixo |
| **Status** | **REDUZIDO** — fail-secure em produção ✅, bootstrap warning ✅, testes integrais ✅, `.env.example` documenta `DESK_ENV` e requisito de prod ✅ |
| **Recomendação** | Manter `WEBHOOK_SECRET` vazio apenas em `.env` de desenvolvimento. Produção deve usar `.env.production.example` como referência. |

---

### G-05: Dead-Letter Queue — UI e Captura Runtime

| Campo | Detalhe |
|-------|---------|
| **Nome** | Dead-letter funcional mas sem interface operacional |
| **Descrição** | O mecanismo de dead-letter existe em `packages/events/src/dead-letter.ts`. A UI operacional mínima existe no admin, com listagem, filtro, inspeção do payload e ações de `retry` quando a entrada carrega `sourceEvent`, ou `resolve` manual quando não há envelope suficiente para replay. O runtime do `message-worker` grava automaticamente o `sourceEvent` do evento original nas falhas terminais e adiciona `failureContext` estruturado com handler, decisão, retry count, correlation id e motivo operacional. O admin também expõe `/admin/dead-letters/stats` para resumo operacional e `/admin/webhook-security/stats` para agregação dos `reason` do guard; ambos são contadores process-local/in-memory úteis para triagem, não persistência histórica. O `realtime-service` foi auditado e não entrou no mesmo padrão porque não tem boundary terminal equivalente: eventos não projetáveis são apenas ignorados/ackados, evitando ruído operacional. |
| **Evidência no código** | `modules/admin/src/presentation/http/admin.controller.ts` — rotas `/admin/dead-letters`, `/admin/dead-letters/stats`, `/admin/dead-letters/:id/retry`, `/admin/dead-letters/:id/resolve` e `/admin/webhook-security/stats`; `apps/desk-web/src/pages/Admin.tsx` — aba `Dead-letter` com resumo operacional e seção de webhook security; `apps/message-worker/src/dead-letter.ts` — helper `recordWorkerDeadLetter`; `apps/message-worker/src/index.ts` — captura terminal com `recordWorkerDeadLetter`; `packages/events/src/dead-letter.ts` — `failureContext` estruturado e resumo operacional; `packages/shared/src/webhook-guard.ts` — `reason` operacional em respostas, logs e contadores; `apps/realtime-service/src/index.ts` — eventos não projetáveis são ackados sem dead-letter |
| **Impacto** | Operações de triagem e tratamento manual de mensagens com falha agora podem ser feitas no admin, sem depender de curl ou acesso direto ao banco. O retry contextual funciona nos casos terminais do worker; o triage por stats reduz a inspeção item a item; realtime permanece sem dead-letter replayável até existir um boundary técnico real para isso. |
| **Severidade** | 🟢 Baixo |
| **Status** | **MITIGADO** — UI operacional mínima entregue; runtime do worker grava `sourceEvent` automaticamente nas falhas terminais; admin expõe stats operacionais de dead-letter e webhook; realtime foi auditado e mantido fora do padrão replayável por não ter boundary terminal equivalente |
| **Recomendação** | Manter replay contextual apenas para runtimes com falha terminal real; entradas legadas ou sem envelope continuam usando `resolve` manual |

---

### G-06: Testes Sem Cobertura Enterprise

| Campo | Detalhe |
|-------|---------|
| **Nome** | Infraestrutura existe, cobertura em expansão |
| **Descrição** | Testes existem e passam (27 packages). G-06 avançou com testes comportamentais e de integração reais em HTTP/API: idempotência inbound, webhook security, realtime auth behavior, auth routes, chat routes, events polling, kanban move e integração Secretary/handoff. A cobertura premium de módulos menos protegidos também ganhou use-case tests para `labels`, `sectors`, `transfers`, `contact-groups`, `contacts` e `dashboard`. A camada HTTP real da `desk-api` agora inclui integrações para `labels`, `sectors`, `contact-groups`, `transfers` e `contacts`, com `GET /contacts/:id` validado sem `skip` e sem erro de consulta vazia, fechando a pendência específica auditada para esses módulos. A observabilidade também ganhou testes reais para stats de dead-letter e webhook security. Playwright foi instalado, configurado e validado com smoke browser-driven real. Send message smoke implementado com fixture de conversa em `e2e/smoke/support.ts:ensureE2EConversation()`. A stack mínima reproduzível do smoke fica em `docker-compose.smoke.yml` e é acionada pelos scripts `e2e:stack:up/down/logs` e `test:e2e:smoke`. As suítes PostgreSQL real mais valiosas também ganharam CI dedicado em `.github/workflows/postgres-real-tests.yml`, via `pnpm test:postgres-real`. |
| **Evidência no código** | `pnpm test` passa (27/27); `playwright.config.ts` configurado; `docker-compose.smoke.yml` para PostgreSQL/Redis do smoke; `e2e/support/start-e2e-stack.ts` bootstrapa migrations + admin + stack mínima em portas isoladas; `e2e/smoke/login-flow.test.ts` (4 testes); `e2e/smoke/inbox-authenticated.test.ts` (1 teste); `e2e/smoke/create-task.test.ts` (4 testes); `e2e/smoke/kanban.test.ts` (1 teste); `e2e/smoke/send-message.test.ts` (3 testes com fixture `ensureE2EConversation()` em `e2e/smoke/support.ts`); `modules/chat/src/__tests__/receive-inbound-idempotency.test.ts` (idempotência); `packages/events/src/__tests__/outbox-fanout-behavioral.test.ts`; `packages/events/src/__tests__/outbox-reader-real.test.ts`; `packages/events/src/__tests__/schema-check.test.ts`; `packages/shared/src/__tests__/webhook-guard.test.ts` e `packages/shared/src/__tests__/webhook-security-stats.test.ts` (webhook security comportamental); `apps/realtime-service/src/__tests__/realtime-auth-behavioral.test.ts` (4 testes comportamentais); `apps/desk-api/src/__tests__/auth-routes.integration.test.ts`; `apps/desk-api/src/__tests__/chat-routes.integration.test.ts`; `apps/desk-api/src/__tests__/webhook-inbound.integration.test.ts`; `apps/desk-api/src/__tests__/webhook-security-stats.integration.test.ts`; `apps/desk-api/src/__tests__/events-polling.integration.test.ts`; `apps/desk-api/src/__tests__/kanban-routes.integration.test.ts`; `apps/desk-api/src/__tests__/labels-routes.integration.test.ts` (11 testes); `apps/desk-api/src/__tests__/sectors-routes.integration.test.ts` (12 testes); `apps/desk-api/src/__tests__/contact-groups-routes.integration.test.ts` (12 testes); `apps/desk-api/src/__tests__/transfers-routes.integration.test.ts` (10 testes); `apps/desk-api/src/__tests__/contacts-routes.integration.test.ts` (13 testes); `apps/desk-api/src/__tests__/dead-letter-routes.integration.test.ts`; `modules/secretary-adapter/src/__tests__/invoke-secretary.integration.test.ts`; `modules/secretary-adapter/src/__tests__/trigger-handoff.integration.test.ts`; `modules/chat/src/__tests__/secretary-handoff.integration.test.ts`; `apps/desk-web/src/__tests__/realtime.test.ts` (MockWebSocket, 5 testes); `.github/workflows/postgres-real-tests.yml` |
| **Impacto** | Risco de regressão reduzido com novos testes comportamentais e uma esteira mínima de CI para PostgreSQL real |
| **Severidade** | 🟡 Médio |
| **Status** | **PARCIAL** — Playwright instalado ✅, smoke tests implementados ✅, E2E executados ✅, GitHub Actions smoke pipeline criado (`.github/workflows/smoke-e2e.yml`) ✅, CI PostgreSQL real mínimo criado (`.github/workflows/postgres-real-tests.yml`) ✅, cobertura enterprise total ainda aberta |
| **Recomendação** | Expandir o smoke apenas se houver novo risco operacional; manter os testes HTTP com PostgreSQL migrado e Fastify real |

---

### G-07: Eventos Sem Versionamento Explícito — RESOLVIDO

| Campo | Detalhe |
|-------|---------|
| **Nome** | Ausência de `event_version` no envelope |
| **Descrição** | O envelope de eventos agora carrega `event_version` explícito, com default `1`, separado da coluna `version` do outbox. O valor é persistido em `outbox_events.event_version` e reconstituído por publisher, reader, worker, realtime e replay de dead-letter. |
| **Evidência no código** | `packages/events/src/envelope.ts`; `packages/events/src/outbox-publisher.ts`; `packages/events/src/outbox-reader.ts`; `packages/database/src/schema.ts`; `packages/database/supabase/migrations/0012_outbox_event_version.sql` |
| **Impacto** | O contrato do evento fica versionado de forma explícita sem confundir com a versão operacional do aggregate no outbox. |
| **Severidade** | 🟢 Baixo |
| **Status** | **PRONTO** — `event_version` explícito, propagado e com default seguro |
| **Recomendação** | Manter `event_version` como contrato do evento; usar `version` apenas para a versão operacional do outbox/aggregate quando necessário |

---

## 5. Priorização Executiva

| Prioridade | Gaps | Rationale |
|------------|------|-----------|
| 🟢 Baixo | Nenhum gap crítico aberto — G-01 mitigado via outbox, G-02 mitigado via revalidação periódica | Sistema funcional para produção |
| 🟡 Médio | G-06 (Cobertura testes) | Impacta qualidade e robustez — em expansão contínua |
| 🟢 Baixo | G-02 (Token revalidation — **MITIGADO**), G-04 (Webhook — **REDUZIDO**), G-05 (Dead-letter UI — **MITIGADO**) | Úteis mas não bloqueantes |
| ✅ Fechados | G-03 (Token na URL — **PRONTO**), G-07 (event_version — **PRONTO**) | Entregues e testados |

---

## 6. Próximos Passos Recomendados

### Curto Prazo

1. **Expandir cobertura de testes** — G-06; focar em Playwright adicional e no restante dos flows operacionais
2. **GitHub Actions smoke E2E configurado** — `.github/workflows/smoke-e2e.yml` criado; executa em push e PR; usa stack dedicada `docker-compose.smoke.yml` + `pnpm test:e2e:smoke`; artifacts de trace/report em falha

### Médio Prazo

3. **Dashboard KPIs avançados** — tempos médios de resposta, handoff rate (requer dados históricos suficientes)
4. **Monitoring/alerting de produção** — métricas runtime via logs estruturados + collector externo (Datadog, CloudWatch, etc.)
5. **Premium de produto** — fase 3 do plano executivo

---

## 7. Critério de Atualização

Este documento deve ser atualizado quando:

1. Um gap for resolvido — mover para seção de "resolvidos" com data
2. Um novo gap for identificado — adicionar com evidência de código
3. Severidade de um gap mudar — atualizar classificação
4. Decisão arquitetural afetar um gap — documentar decisão

**Responsável pela atualização:** Qualquer engineer que resolver ou identificar um gap deve atualizar este documento.

**Frequência mínima de revisão:** A cada sprint onde houver mudança significativa no estado técnico.

---

## 8. Resumo Executivo

| Categoria | Quantidade |
|-----------|------------|
| Gaps críticos | 0 |
| Gaps médios | 1 (G-06) |
| Gaps baixos | 3 (G-02 mitigado, G-04 reduzido, G-05 mitigado) |
| Itens resolvidos (não são mais gaps) | 10 |

**Status do G-01:** MITIGADO — Pipeline de eventos agora funciona via banco com fan-out por consumer.

**Status do G-02:** MITIGADO — Revalidação periódica implementada via `REALTIME_AUTH_REVALIDATE_MS`. Conexões são fechadas com código 4002 quando token é revogado.

**Status do G-03:** PRONTO — o cliente principal autentica por mensagem e não expõe token na URL.

**Status do G-04:** REDUZIDO — fail-secure em produção (500 sem `WEBHOOK_SECRET`), bootstrap warning em stderr, testes integrais, `.env.example` documenta requisito de produção.

**Status do G-05:** MITIGADO — UI operacional minima entregue; runtime do worker grava `sourceEvent` automaticamente nas falhas terminais; admin expõe `/admin/dead-letters/stats` e `/admin/webhook-security/stats`; realtime auditado e mantido fora do padrão replayável.

---

**Status do G-07:** PRONTO — `event_version` explícito, persistido e propagado no pipeline.

**Última revisão:** 2026-04-10
**Fontes:** Relatórios 26, 27, 29; Validação de código; Implementação de fan-out; Plans 66, 68
**Fase 2 status:** ENCERRADA — logs estruturados Worker/Realtime ✅, dead-letter stats ✅, webhook security stats ✅, documentação consolidada ✅
