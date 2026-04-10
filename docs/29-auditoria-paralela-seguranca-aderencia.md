# Auditoria Paralela: Segurança, Aderência Documental e Riscos de Integração
**Data:** 2026-04-09
**Escopo:** Análise complementar à task principal de testes — foco em segurança, aderência e gaps de integração
**Metodologia:** Validação de claims documentais contra código-fonte

---

## 1. Documentos Usados como Fonte da Verdade

### Base normativa:
- `11-security-and-access-control.md` — Autenticação, RBAC, webhook, gestão de segredos
- `10-realtime-and-events.md` — Eventos, envelope, realtime, idempotência, retry
- `18-deployment-and-runtime.md` (atualizado 2026-04-09) — Runtimes, portas, variáveis de ambiente
- `15-implementation-phases.md` — Fases e cadeia de dependência

### Relatórios de rastreabilidade:
- `27-relatorio-executivo-rastreabilidade-documentacao-vs-codigo.md` — Comparativo docs vs código
- `23-auditoria-executiva.md` — Estado geral (desatualizado)
- `28-relatorio-executivo-testes-infraestrutura.md` — Status da infraestrutura de testes

---

## 2. Estado Atual do Código no Escopo Analisado

### 2.1 Realtime-Service — Autenticação

**O que existe:**
- `extractTokenFromUrl()` — Extrai token do query param `?token=<jwt>`
- `validateTokenAndAuthenticate()` — Valida token via HTTP para `/auth/me` (Bearer token)
- `authTimeout` de 5 segundos — Timeout para conexão sem autenticação
- `completeAuthentication()` — Marca client como autenticado, adiciona canal `user:${userId}`
- `rejectAuthentication()` — Fecha conexão com código `4003` ("Authentication failed")
- `handleSubscribe` — Requer `client.authenticated === true` antes de permitir subscribe
- `broadcast()` — Só envia para clients autenticados (`client.authenticated && client.subscriptions.has(channel)`)

**Veredicto: FUNCIONAL e ADERENTE à documentação `11-security-and-access-control.md`**

### 2.2 Webhook-Guard — Segurança de Inbound

**O que existe:**
- Fail-secure em produção: rejeita com 500 se `WEBHOOK_SECRET` não configurado
- HMAC-SHA256 com `timingSafeEqual` (previne timing attacks)
- Validação de formato: `sha256=<hex>`
- Header `X-Webhook-Signature` obrigatório em produção

**Veredicto: FUNCIONAL e SUPERIOR ao que a documentação `11-security-and-access-control.md` sugere**

A documentação diz "webhook security ainda precisa de endurecimento adicional (rate limiting, assinatura)" — mas a **assinatura HMAC já está implementada** com fail-secure.

### 2.3 Rate Limiting

**O que existe:**
- `@fastify/rate-limit` registrado na API (`apps/desk-api/src/index.ts`)
- Configurável via `RATE_LIMIT_MAX` e `RATE_LIMIT_WINDOW`

**Veredicto: IMPLEMENTADO** — Contradiz afirmação antiga de que não existia

### 2.4 Realtime Conectado ao Frontend

**O que existe:**
- `apps/desk-web/src/pages/Inbox.tsx:58` — `realtimeClient.connect(user.id, token)`
- Polling de fallback configurável

**Veredicto: CONECTADO** — Contradiz `23-auditoria-executiva.md` que dizia o contrário

---

## 3. Aderência à Documentação — Análise Item a Item

### 3.1 Itens Aderentes ✅

| Documento | Claim | Validação |
|-----------|-------|-----------|
| `11-security-and-access-control.md` | Realtime exige identidade validada | ✅ Código valida via `/auth/me` |
| `11-security-and-access-control.md` | Backend como autoridade | ✅ API é fonte primária |
| `11-security-and-access-control.md` | RBAC centralizado em packages/auth | ✅ Middleware `requirePermission`, `requireRole` |
| `11-security-and-access-control.md` |Webhook com HMAC | ✅ Implementado com fail-secure |
| `10-realtime-and-events.md` | Eventos envelope com campos mínimos | ✅ `packages/events/src/envelope.ts` |
| `10-realtime-and-events.md` | Realtime como projeção, não fonte | ✅ `processEvent` só projeta |
| `10-realtime-and-events.md` | Idempotência obrigatória | ✅ `packages/events/src/consumer.ts` |
| `18-deployment-and-runtime.md` | Porta realtime 8080 | ✅ Atualizado no documento |
| `18-deployment-and-runtime.md` | Rate limiting implementado | ✅ `@fastify/rate-limit` registrado |

### 3.2 Itens Parcialmente Aderentes 🟡

| Documento | Claim | Status Real | Lacuna |
|-----------|-------|-------------|--------|
| `11-security-and-access-control.md` | Rate limiting configurável por endpoint | `@fastify/rate-limit` existe, mas não verificado se por endpoint | Precisa validar se rate limit se aplica a `/auth/login` separadamente |
| `10-realtime-and-events.md` | Dead-letter queue para falhas | Implementado em `packages/events/src/dead-letter.ts`, mas sem UI de gerenciamento | Funcional, sem dashboard |
| `10-realtime-and-events.md` | correlation_id preservado | Código preserva, mas não verificado se todos os eventos preenchem | Parcial — depende da implementação de cada use case |

### 3.3 Itens Divergentes ❌

| Documento | Claim | Estado Real | Problema |
|-----------|-------|-------------|----------|
| `27-relatorio-executivo-rastreabilidade...md` | "Realtime não valida de forma forte a identidade" | Validação forte via `/auth/me` existe | **Documento está desatualizado** |
| `27-relatorio...` | "Webhook tem mecanismo opcional" | Fail-secure em produção implementado | **Documento subestima implementação** |
| `23-auditoria-executiva.md` | "Realtime não está conectado ao frontend" | `realtimeClient.connect()` existe no Inbox | **Documento está desatualizado** |
| `23-auditoria-executiva.md` | "Secretary não está integrada" | `processMessageWithSecretary()` é chamado no inbound | **Documento está desatualizado** |
| `23-auditoria-executiva.md` | "Testes são ausentes" | 225 testes passando | **Documento está desatualizado** |

---

## 4. Riscos para Integração

### 4.1 Riscos de Segurança 🔴

| Risco | Severidade | Descrição | Mitigação Documentada |
|-------|------------|-----------|---------------------|
| Webhook bypass em dev | 🟡 Médio | `WEBHOOK_SECRET` não configurado = validation disabled com warning | Fail-secure só em produção; acceptable para dev |
| Token na URL | 🟡 Médio | Token JWT visível em query string do WebSocket (`?token=...`) | Logs não devem expor token completo; URL pode ficar em history |
| Realtime sem TLS | 🟡 Médio | WebSocket em `ws://` não `wss://` por padrão | TLS deve ser configurado no proxy/reverse proxy |

### 4.2 Riscos Operacionais 🟡

| Risco | Severidade | Descrição |
|-------|------------|-----------|
| Publisher in-memory | 🔴 Alto | API e worker/em memória — não sustentam comunicação inter-processo em múltiplas instâncias |
| Dead-letter sem UI | 🟡 Médio | Dead-letter implementado mas sem dashboard de gerenciamento |
| Eventos sem versão | 🟡 Médio | Não há `event_version` explícito nos envelopes — evolução pode quebrar consumers |
| Polling interval | 🟡 Médio | Realtime polling de 500ms pode gerar carga desnecessária se muitas conexões |

### 4.3 Riscos de Documentação 🟡

| Risco | Descrição |
|-------|-----------|
| docs/23-auditoria-executiva.md | Descritivo de estado antigo — não usar como referência |
| docs/27-relatorio... | Subestima níveis de segurança já implementados |
| AUDITORIA_IMPLEMENTACAO.md | Contém conclusões incorretas sobre o estado atual |

### 4.4 Riscos de Integração entre Módulos 🟡

| Risco | Severidade | Descrição |
|-------|------------|-----------|
| `@cvg/audit` import quebrado | 🔴 Crítico | Build do `message-worker` falha com "Cannot find module '@cvg/audit'" |
| Events via polling | 🟡 Médio | Realtime consome via polling (`/events?since=...`) — latência de até 500ms |
| Worker polling | 🟡 Médio | Worker polling de 500ms para eventos — se muitos workers, pode duplicar processamento |

---

## 5. Sugestões para a Task Principal

### 5.1 Correções Recomendadas

1. **Atualizar `docs/23-auditoria-executiva.md`**
   - Adicionar selo "HISTÓRICO — estado de 2026-03"
   - Ou marcar seções como "incorreto no código atual"

2. **Atualizar `docs/27-relatorio...`**
   - Corrigir claim "realtime não valida identidade" → realtime JÁ valida via `/auth/me`
   - Corrigir claim "webhook opcional" → webhook JÁ tem fail-secure em produção

3. **Corrigir build do message-worker**
   - Import de `@cvg/audit` em `modules/alerts/src/application/use-cases/acknowledge-alert.use-case.ts` não resolve
   - Afeta deployment real

### 5.2 Testes Recomendados (complementares aos já criados)

1. **Teste de autenticação realtime**
   - Validar que `validateTokenAndAuthenticate` é chamado
   - Validar que conexão sem token é rejeitada após timeout
   - Validar que `authTimeout` de 5s funciona

2. **Teste de webhook fail-secure**
   - `WEBHOOK_SECRET` ausente em produção → 500
   - `WEBHOOK_SECRET` ausente em dev → warning + continua

3. **Teste de idempotência de eventos**
   - Publicar evento 2x com mesmo `event_id`
   - Consumer deve processar só 1x

4. **Teste de rate limiting**
   - exceeding `RATE_LIMIT_MAX` requests → 429

### 5.3 Validações Recomendadas

1. **Verificar se todos os eventos preenchem `correlation_id`**
   - Inbound → persist → handoff outbound deve ter correlation preservado

2. **Verificar se realtime-service conecta em wss:// (não ws://) em produção**
   - TLS termination pode ser no proxy

3. **Verificar se polling intervals são configuráveis**
   - `REALTIME_POLL_INTERVAL_MS`
   - `WORKER_POLL_INTERVAL_MS`

---

## 6. Próximos Passos

### Imediato (bloqueantes):
1. **Corrigir build do message-worker** — Import de `@cvg/audit` quebrado impede deployment
2. **Verificar se `correlation_id` é preenchido em todos os eventos do inbound** — Auditar use cases

### Curto prazo:
3. **Instalar e configurar Playwright** — T6 do plano de testes
4. **Teste de webhook security** — HMAC validation, fail-secure
5. **Teste de realtime auth** — validateTokenAndAuthenticate, timeout, rejection

### Médio prazo:
6. **Migrar publisher in-memory para outbox/fila** — Decisivo para produção com múltiplas instâncias
7. **Versão explícita nos eventos** — Adicionar `event_version` ao envelope
8. **Dashboard para dead-letter** — UI simples para retry manual

### Longo prazo:
9. **TLS para WebSocket** — wss:// em produção
10. **Rate limiting por endpoint** — `/auth/login` mais restritivo que `/health`

---

## 7. Nota sobre Documentos Desatualizados

Os seguintes documentos contêm informações que **não correspondem ao código atual**:

| Documento | Problema Principal |
|-----------|-------------------|
| `docs/23-auditoria-executiva.md` | Descreve estado de semanas atrás; realtime, secretary, testes e auth estão mais maduros |
| `docs/27-relatorio...` | Subestima nível de implementação de segurança |
| `docs/AUDITORIA_IMPLEMENTACAO.md` | Múltiplas claims incorretas verificáveis no código |

**Recomendação:** Adicionar selo "HISTÓRICO" ou "DESATUALIZADO" a esses documentos, ou arquivá-los em subpasta `/docs/legacy/`.

---

*Auditoria executada por análise de código-fonte e comparação com documentação. Testes funcionais não foram executados nesta auditoria — apenas validação estática.*
