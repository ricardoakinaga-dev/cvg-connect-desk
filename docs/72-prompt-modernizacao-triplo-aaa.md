# Prompt de Modernização — CVG Connect Desk State of Art Triplo AAA

> Cópia fiel do prompt fornecido pelo usuário em 2026-09-12, salva em `docs/` para rastreabilidade.

---

Você está atuando como Principal Engineer, Security Engineer, Reliability Engineer, Staff Backend Engineer, Staff Frontend Engineer, SRE, Platform Engineer e Software Architect.

Sua missão é auditar, modernizar e implementar todas as melhorias necessárias no repositório:

https://github.com/ricardoakinaga-dev/cvg-connect-desk

OBJETIVO FINAL

Levar o `cvg-connect-desk` ao nível:

STATE OF ART
TRIPLO AAA
PRODUCTION-GRADE
SECURITY-HARDENED
FAILURE-RESILIENT
OBSERVABLE
MECHANICALLY VERIFIABLE

Não faça uma reescrita total do projeto.

Preserve a arquitetura existente quando ela estiver correta e evolua incrementalmente o sistema.

O projeto já possui uma boa fundação e deve ser tratado como um sistema existente em processo de hardening e promoção, e não como um greenfield.

==================================================

1. CONTEXTO DO SISTEMA
   ==================================================

O CVG Connect Desk é a camada operacional de atendimento digital e coordenação interna do Centro Veterinário Guarapiranga.

Fluxo principal:

WhatsApp
→ Evolution API
→ gateway_evochatwoot
→ CVG Connect Desk
→ Agent Secretary / IA
→ operadores humanos

O CVG Connect Desk possui atualmente:

* Fastify + TypeScript
* React + Vite
* PostgreSQL
* Drizzle ORM
* Redis
* WebSocket / realtime
* pnpm workspaces
* Turborepo
* workers assíncronos
* outbox
* idempotência
* dead-letter queue
* RBAC
* setores
* tarefas
* alertas
* notas
* contatos
* grupos
* Kanban
* auditoria
* integração com gateway
* integração com Agent Secretary
* testes unitários
* testes de integração
* PostgreSQL real em CI
* E2E com Playwright
* Docker Compose de produção

Não degrade funcionalidades existentes.

Não quebre compatibilidade sem necessidade.

==================================================
2. PRINCÍPIOS DE IMPLEMENTAÇÃO
==============================

Todas as decisões devem seguir estes princípios:

1. Security by default.
2. Fail-secure para recursos críticos.
3. Idempotency everywhere.
4. Explicit contracts.
5. Least privilege.
6. Defense in depth.
7. Observability first.
8. Deterministic behavior.
9. Backward compatibility quando razoável.
10. Zero silent failure.
11. No hidden fallback perigoso.
12. No mock-only confidence.
13. Production behavior deve ser testado com infraestrutura real.
14. Toda garantia crítica deve possuir teste ou gate mecanicamente verificável.
15. Preferir composição modular a acoplamento.
16. Evitar abstrações prematuras.
17. Evitar microservices desnecessários.
18. Nenhum segredo hardcoded.
19. Nenhuma credencial padrão insegura.
20. Todo retry deve ser bounded.
21. Toda chamada externa deve possuir timeout.
22. Toda operação assíncrona deve definir semântica de retry, ACK, DLQ e idempotência.
23. Todo acesso administrativo deve ser auditável.
24. Toda integração de IA deve possuir limites explícitos de autoridade.
25. Não declarar sucesso sem evidência executável.

==================================================
3. PRIMEIRO PASSO OBRIGATÓRIO — DISCOVERY
=========================================

Antes de alterar qualquer código:

* leia completamente a estrutura do repositório;
* identifique apps, modules, packages e services;
* leia README e docs relevantes;
* leia package.json raiz e dos principais módulos;
* leia workflows;
* leia Dockerfiles e compose;
* leia schema Drizzle e migrations;
* leia autenticação;
* leia RBAC;
* leia webhook inbound;
* leia gateway adapter;
* leia outbox/event system;
* leia DLQ;
* leia worker;
* leia realtime;
* leia Agent Secretary adapter;
* leia frontend relacionado a Inbox;
* identifique testes existentes.

Produza internamente um mapa arquitetural:

Component
Responsibility
Inputs
Outputs
Trust Boundary
Persistence
Failure Modes
Security Requirements
Observability Requirements

Não comece modificações cegamente.

==================================================
4. PHASE 1 — SECURITY & CORRECTNESS CLOSURE
===========================================

Implemente primeiro todas as falhas críticas de segurança e correção.

---

## 4.1 Webhook HMAC sobre raw body

O webhook não deve validar HMAC usando:

JSON.stringify(request.body)

quando o emissor assina bytes crus.

Implemente captura segura do raw request body.

A assinatura deve ser calculada usando os bytes exatos recebidos.

Contrato esperado:

X-Webhook-Signature: sha256=<digest>

Use:

HMAC-SHA256
crypto.timingSafeEqual

Valide:

* algoritmo;
* tamanho do digest;
* formato hexadecimal;
* header ausente;
* segredo ausente.

Em produção:

WEBHOOK_SECRET ausente
→ startup deve falhar ou endpoint deve ficar explicitamente indisponível.

Preferir falha de startup se webhook inbound for dependência obrigatória.

---

## 4.2 Anti-replay

Adicionar:

X-Webhook-Timestamp
X-Webhook-Event-Id

A assinatura deve preferencialmente cobrir:

timestamp + "." + rawBody

ou um envelope equivalente documentado.

Implementar:

MAX_WEBHOOK_CLOCK_SKEW_SECONDS

por exemplo 300 segundos.

Rejeitar timestamps:

* muito antigos;
* muito futuros;
* inválidos.

Persistir/cachear IDs já processados.

O mesmo webhook event ID não pode executar side effects novamente.

Redis pode ser usado para cache de replay com TTL.

Fallback crítico deve ser explícito.

Adicionar testes:

* valid signature;
* invalid signature;
* old timestamp;
* future timestamp;
* duplicate event ID;
* missing timestamp;
* missing event ID;
* malformed signature.

---

## 4.3 Canonical Message ID obrigatório

Remover fallback inseguro como:

msg_${Date.now()}

para mensagens inbound reais.

Para produção:

externalMessageId deve ser fornecido pelo gateway.

Se o payload upstream não possuir ID:

* rejeitar como payload inválido;
  OU
* gerar fingerprint determinístico documentado apenas como compatibilidade transitória.

Fingerprint, se necessário:

SHA-256(
provider
instanceId
sender
recipient
normalizedTimestamp
media identity
normalizedContent
)

Não utilizar timestamp local isolado.

Criar unique constraint apropriada.

Adicionar teste de entrega duplicada.

---

## 4.4 Session token hashing

Nunca persistir bearer/session tokens em plaintext.

Fluxo:

token aleatório criptograficamente seguro
→ entregue ao cliente
→ SHA-256 ou HMAC
→ persistir apenas token hash

Schema de sessão recomendado:

id
user_id
token_hash
created_at
last_seen_at
expires_at
absolute_expires_at
revoked_at
revoked_reason
ip_hash opcional
user_agent_hash opcional

Criar:

logout
logout-all
session revoke
session rotation
idle timeout
absolute timeout

Comparação deve ocorrer por hash.

Adicionar migration segura.

---

## 4.5 Bootstrap admin seguro

Remover credencial default fixa:

admin@...
admin123

Produção deve exigir bootstrap seguro.

Opções aceitáveis:

ADMIN_BOOTSTRAP_EMAIL
ADMIN_BOOTSTRAP_PASSWORD

ou token de bootstrap one-time.

Requisitos:

* senha forte obrigatória;
* first-login password change quando aplicável;
* bootstrap desabilitado após uso;
* nenhuma senha default em docs;
* nenhuma senha hardcoded em seed de produção.

---

## 4.6 CORS fail-secure

Em produção:

CORS_ORIGIN ausente ou "*"
→ startup failure.

Permitir wildcard apenas explicitamente em desenvolvimento/test.

Validar lista de origins.

Adicionar testes.

---

## 4.7 Rate limiting segmentado

Criar políticas separadas:

global limiter
auth/login limiter
webhook limiter
message-send limiter
admin limiter
sensitive write limiter

Não usar fail-open silencioso em endpoints sensíveis.

Reavaliar skipOnError.

Quando storage de rate limit falhar:

* endpoints críticos devem degradar de forma segura;
* registrar métrica;
* emitir log estruturado;
* não liberar tráfego ilimitado silenciosamente.

---

## 4.8 Readiness real

O readiness deve realmente testar dependências.

Postgres:
SELECT 1 ou query mínima apropriada.

Redis:
PING real.

Gateway:
quando considerado critical dependency, health real.

Migrations:
detectar schema incompatível quando possível.

Retornar estrutura:

ready
checks
degraded
timestamp
version

Diferenciar:

liveness
readiness
degraded dependencies

Agent Secretary provavelmente deve ser opcional/degraded e não derrubar atendimento humano.

==================================================
5. PHASE 2 — MESSAGING RELIABILITY
==================================

---

## 5.1 Contratos formais

Criar pacote compartilhado:

@cvg/messaging-contracts

Definir contratos versionados:

InboundMessageV1
OutboundMessageV1
DeliveryReceiptV1
ReadReceiptV1
MediaMessageV1
InstanceStatusV1
ProviderErrorV1
CanonicalEventEnvelopeV1

Envelope sugerido:

{
specVersion,
eventId,
eventType,
occurredAt,
source,
provider,
instanceId,
correlationId,
causationId,
traceId?,
payload
}

Usar Zod ou JSON Schema.

Validar payloads nas fronteiras.

Adicionar contract tests entre:

gateway
desk-api
worker

Não acoplar domínio do Desk diretamente ao payload cru da Evolution API.

---

## 5.2 Provider abstraction

Criar abstração:

interface MessagingProvider {
sendText()
sendImage()
sendAudio()
sendVideo()
sendDocument()
getMedia()
getInstanceStatus()
}

Criar:

EvolutionProvider

Não chamar APIs específicas da Evolution diretamente em regras de domínio.

Preparar extensão futura para:

EvolutionGoProvider
WhatsAppOfficialProvider
TelegramProvider

sem alterar domínio.

---

## 5.3 Retry policy central

Criar uma policy central para chamadas externas.

Toda chamada externa precisa de:

timeout
retry classification
bounded retries
exponential backoff
jitter
retry-after support
circuit breaker quando aplicável

Nunca retry automático de erro não idempotente sem idempotency key.

Classificar:

network error
timeout
429
5xx
4xx permanent
schema invalid
auth error
provider unavailable

---

## 5.4 Idempotency outbound

Toda mensagem outbound deve possuir:

clientMessageId
idempotencyKey

Persistir mapping:

internal_message_id
provider_message_id
idempotency_key
attempt_count
last_attempt_at
status

Não duplicar mensagem ao WhatsApp após crash/retry.

---

## 5.5 Ordering

Definir explicitamente semântica de ordenação por conversa.

Mensagens de uma mesma conversation/instance devem evitar reordenação indevida.

Implementar, quando necessário:

conversation sequence
partition key
advisory lock
FIFO semantics
serial execution por conversation

Não bloquear conversas independentes.

---

## 5.6 Outbox robusto

O outbox deve suportar:

pending
leased
processing
completed
dead-letter

Campos sugeridos:

id
event_id
consumer_id
status
lease_owner
lease_until
delivery_count
next_attempt_at
last_error_code
last_error_message
acked_at
created_at

Claim deve ser atômico.

Usar:

SELECT ... FOR UPDATE SKIP LOCKED

ou mecanismo equivalente.

---

## 5.7 Não ACK em GET

Remover comportamento em que:

GET /events
→ busca evento
→ já marca como acknowledged

Criar semântica segura:

GET /events
→ claim/lease

POST /events/:id/ack
→ acknowledge

ou substituir polling por infraestrutura adequada.

Response perdido não pode causar perda lógica de evento.

---

## 5.8 DLQ operacional

Implementar interface de DLQ com:

* list;
* inspect;
* replay;
* replay batch;
* discard;
* metadata;
* attempt history.

Replay deve ser idempotente.

Toda ação manual de DLQ deve entrar em audit log.

Adicionar filtros:

eventType
errorType
date
consumer
attemptCount

==================================================
6. PHASE 3 — MEDIA PIPELINE
===========================

Criar pipeline seguro para:

image
audio
video
document

Fluxo:

receive metadata
→ validate allowed MIME
→ validate file size
→ controlled download
→ SSRF protection
→ malware scan quando disponível
→ SHA-256
→ object storage
→ DB metadata

Evitar base64 grande no banco.

Preferir storage S3-compatible:

MinIO
S3
R2
ou equivalente abstraído.

Schema sugerido:

media_id
message_id
storage_provider
storage_key
sha256
mime_type
size_bytes
filename
source_url_hash
status
created_at
retention_until

Implementar:

signed URLs
expiração
download authorization
MIME sniffing
safe filename handling

Bloquear:

file://
localhost
127.0.0.1
169.254.169.254
private networks indevidas
redirects para destinos privados

Implementar proteção SSRF real.

==================================================
7. PHASE 4 — AUTHORIZATION & ZERO TRUST
=======================================

---

## 7.1 Evoluir RBAC

Manter roles existentes, mas evoluir para:

RBAC
+
sector scope
+
resource scope
+
ownership/context

Modelo:

user
roles
sector memberships
explicit grants
resource permissions

Criar API central:

authorize(user, action, resource, context)

---

## 7.2 Setores

Usuário de recepção não deve automaticamente enxergar tudo.

Permissão deve considerar:

assigned sector
allowed sectors
admin override
manager scope

Adicionar testes negativos.

---

## 7.3 Sensitive actions

Definir ações críticas:

admin permission changes
delete contact
delete conversation
DLQ replay
manual message resend
AI privileged action
session revoke
configuration change

Exigir autorização específica.

==================================================
8. PHASE 5 — AI SAFETY & SECRETARY INTEGRATION
==============================================

O Agent Secretary nunca deve possuir autoridade irrestrita.

Criar policy layer.

Classificar ferramentas/ações:

READ_ONLY
SAFE_WRITE
SENSITIVE_WRITE
HUMAN_APPROVAL
FORBIDDEN

Toda ação da IA deve registrar:

agent
model
input reference
tool
arguments sanitizados
decision
policy result
human approval when required
result
trace id

Não armazenar prompt sensível inteiro sem necessidade.

Implementar:

timeouts
circuit breaker
budget limits
maximum tool calls
maximum execution duration
fallback humano

Se Secretary estiver fora:

atendimento humano deve continuar.

A IA não deve ser critical dependency do Desk.

==================================================
9. PHASE 6 — OBSERVABILITY STATE OF ART
=======================================

Integrar OpenTelemetry.

Instrumentar:

desk-api
message-worker
realtime-service
gateway calls
Secretary calls
PostgreSQL
Redis
message lifecycle

Propagar:

trace_id
span_id
correlation_id
causation_id
event_id
message_id
conversation_id
provider_message_id

Criar structured logging.

Nenhum console.log solto em produção.

Adicionar redaction para:

Authorization
cookies
tokens
API keys
phone numbers quando apropriado
PII sensível
webhook secret

---

## 9.1 Metrics

Expor Prometheus ou mecanismo equivalente.

Métricas mínimas:

http_requests_total
http_request_duration_seconds
webhook_requests_total
webhook_rejected_total
webhook_replay_rejected_total
messages_inbound_total
messages_outbound_total
message_processing_duration
provider_errors_total
provider_retry_total
outbox_pending
outbox_oldest_age_seconds
dlq_size
worker_processing_total
worker_failure_total
realtime_connections
realtime_publish_errors
auth_failures_total
rate_limit_hits_total
db_pool_wait
redis_errors_total

---

## 9.2 Dashboards

Criar dashboards documentados:

System Overview
Messaging
Webhook Security
Worker/Outbox
DLQ
Database
Redis
Realtime
AI/Secretary

---

## 9.3 SLOs

Definir SLOs iniciais.

Sugestão:

API availability >= 99.9%
critical webhook availability >= 99.95%
message loss = 0 tolerated
duplicate side effect < 0.001%
inbound persistence P95 < 250 ms
realtime propagation P95 < 500 ms

Criar error budgets.

Documentar metodologia.

==================================================
10. PHASE 7 — CONTAINER & PLATFORM HARDENING
============================================

Revisar todos os Dockerfiles.

Exigir quando compatível:

non-root user
read_only filesystem
no-new-privileges
cap_drop ALL
minimal base image
no shell quando desnecessário
tmpfs /tmp
healthcheck correto
pinned runtime versions

Não expor:

Postgres
Redis
internal services

publicamente.

Produção deve usar reverse proxy/TLS externo.

Redis:

* avaliar ACL/password;
* restringir rede;
* proteger comandos perigosos quando aplicável.

PostgreSQL:

* princípio do menor privilégio;
* credencial exclusiva da aplicação;
* migrations com identidade separada se razoável.

==================================================
11. PHASE 8 — SUPPLY CHAIN SECURITY
===================================

Adicionar CI:

CodeQL
Gitleaks
Trivy
dependency review
pnpm audit
SBOM

Gerar:

CycloneDX SBOM

quando possível.

Pin GitHub Actions por major confiável ou digest conforme política adotada.

Bloquear merge em:

critical vulnerability
high vulnerability explorável sem exceção aprovada
secret leak
failed CodeQL critical/high relevante

Documentar processo de exception.

==================================================
12. PHASE 9 — DATABASE & MIGRATION SAFETY
=========================================

Auditar:

constraints
foreign keys
indexes
unique indexes
cascade behavior
nullable fields
enum/status consistency

Adicionar índices para consultas principais:

conversation
message external id
provider message id
contact phone
sector
status
outbox pending
DLQ
audit
createdAt

Revisar migrations para serem:

repeatable quando necessário
safe
ordered
backward compatible

Criar migration check no CI.

Adicionar teste:

fresh DB
→ run all migrations
→ seed test
→ application boot

Também:

existing previous schema
→ migrate forward

quando viável.

==================================================
13. PHASE 10 — FRONTEND HARDENING
=================================

Não apenas embelezar UI.

Implementar robustez operacional.

Inbox deve lidar com:

loading
empty
offline
reconnecting
failed send
retry send
duplicate prevention
optimistic update rollback
message pending
sent
delivered
read
failed

WebSocket:

reconnect with bounded exponential backoff
heartbeat
stale connection detection
resubscribe after reconnect

Frontend deve validar responses.

Adicionar:

error boundaries
global API error handling
auth expiration handling
safe logout
route permissions
sector-aware UI

Nunca confiar somente em autorização frontend.

==================================================
14. PHASE 11 — PERFORMANCE
==========================

Executar profiling dos hot paths.

Adicionar testes de carga básicos com:

k6
Artillery
ou ferramenta adequada.

Cenários:

50 concurrent users
100 concurrent users
burst inbound webhook
mass conversation list
message pagination
realtime fanout

Verificar:

DB pool
N+1
slow queries
indexes
memory leaks
Redis saturation
worker throughput

Não otimizar cegamente.

Registrar antes/depois.

==================================================
15. PHASE 12 — CHAOS / RESILIENCE
=================================

Criar testes automatizados ou scripts reproduzíveis para:

Postgres unavailable
Redis unavailable
Gateway unavailable
Secretary unavailable
Evolution unavailable
timeouts
HTTP 429
HTTP 500
duplicate webhook
out-of-order receipt
worker crash mid-event
database rollback
WebSocket disconnect
process restart during message send

Critério crítico:

nenhuma mensagem persistida pode desaparecer silenciosamente.

Nenhum side effect deve duplicar sem explicação.

Toda falha deve resultar em:

retry
DLQ
degraded state
ou erro terminal explícito.

==================================================
16. PHASE 13 — LGPD / DATA GOVERNANCE
=====================================

Documentar e implementar infraestrutura para:

data retention
PII classification
data export
data deletion/anonymization
audit trail
encrypted backups
backup retention

Criar abstrações sem remover informação crítica de operação.

Logs devem evitar PII desnecessária.

==================================================
17. PHASE 14 — AUDIT TRAIL
==========================

Audit log crítico deve ser append-only logicamente.

Registrar:

actor
action
resource_type
resource_id
before_hash
after_hash
timestamp
session_id
correlation_id
source_ip quando apropriado

Auditar:

login
logout
session revoke
role change
permission change
sector membership change
conversation transfer
message manual resend
message delete
contact delete
DLQ replay
AI privileged action
admin settings

Não permitir edição normal do audit log.

==================================================
18. PHASE 15 — CI/CD PROMOTION PIPELINE
=======================================

Criar quality gate unificado.

Pipeline de PR:

format/lint
typecheck
unit
integration
real-postgres
contract tests
E2E
coverage
build
migration validation
security scan
dependency scan
secret scan
Docker build
container scan
architecture tests

Estados:

FAILED
CONDITIONAL
VERIFIED_CANDIDATE

Merge para main somente quando critical gates passarem.

---

## 18.1 Coverage

Não usar 100% arbitrariamente.

Definir thresholds realistas e crescentes.

Por exemplo:

statements >= 85%
branches >= 80%
functions >= 85%
lines >= 85%

Para critical modules:

auth
webhook
events
outbox
gateway
security

exigir branches >= 90% se viável.

Coverage jamais substitui quality.

---

## 18.2 Mutation testing

Adicionar mutation testing para componentes críticos quando custo for aceitável.

Priorizar:

webhook security
auth
idempotency
RBAC
event state transitions

---

## 18.3 Architecture tests

Impor dependências permitidas.

Exemplo:

domain não pode depender de Fastify
domain não pode depender diretamente de Evolution SDK
UI não pode acessar DB
shared não pode depender de apps

Falhar CI quando arquitetura for violada.

==================================================
19. PHASE 16 — DISASTER RECOVERY
================================

Criar documentação e scripts para:

backup PostgreSQL
restore PostgreSQL
object storage backup
secret rotation
Redis loss recovery

Definir:

RPO
RTO

Testar restore.

Backup não testado não conta como backup confiável.

==================================================
20. DOCUMENTATION
=================

Atualizar:

README.md
DOCKER_SETUP.md
docs/

Criar documentação:

ARCHITECTURE.md
SECURITY.md
THREAT_MODEL.md
OBSERVABILITY.md
RUNBOOK.md
SLO.md
DISASTER_RECOVERY.md
MESSAGING_CONTRACTS.md
AUTHORIZATION.md
AI_SAFETY.md
PRODUCTION_DEPLOYMENT.md
TRIPLE_AAA_CERTIFICATION.md

Remover instruções obsoletas.

Os scripts:

db:migrate
db:seed

na raiz devem executar operações reais ou ser removidos.

Nenhum placeholder enganoso.

==================================================
21. THREAT MODEL
================

Criar threat model explícito usando STRIDE ou metodologia equivalente.

Cobrir:

internet
reverse proxy
desk-web
desk-api
gateway
Evolution API
Secretary
Redis
Postgres
object storage
workers
WebSocket

Analisar:

spoofing
tampering
repudiation
information disclosure
denial of service
elevation of privilege

Também:

SSRF
injection
IDOR
broken auth
token theft
replay attack
malicious media
dependency compromise
supply chain
webhook forgery
privilege escalation
PII leakage

Para cada ameaça:

asset
trust boundary
attack path
impact
likelihood
mitigation
verification

==================================================
22. TEST MATRIX
===============

Criar matriz única mecanicamente verificável.

Exemplo:

Area | Requirement | Test/Gate | Evidence | Status

Auth
Webhook
RBAC
Messaging
Outbox
DLQ
Gateway
Media
AI
Database
Redis
Realtime
Frontend
Docker
CI
Supply Chain
Observability
Performance
DR
LGPD

Estados:

NOT_TESTED
FAIL
PARTIAL
PASS
VERIFIED

Nenhuma área crítica pode ficar somente documentada.

==================================================
23. CRITÉRIOS STATE OF ART
==========================

O projeto só pode ser classificado como State of Art quando:

* não possuir blocker conhecido de segurança crítica;
* não possuir perda silenciosa de mensagem;
* idempotência inbound e outbound for comprovada;
* retries forem bounded;
* DLQ for operacional;
* contratos forem versionados;
* auth tokens não forem persistidos em plaintext;
* RBAC contextual estiver aplicado;
* webhook possuir HMAC + anti-replay;
* dependências externas possuírem timeout;
* CI bloquear regressões críticas;
* OpenTelemetry estiver operacional;
* SLOs estiverem definidos;
* backups forem restauráveis;
* container hardening estiver aplicado;
* supply-chain scanning estiver ativo;
* testes críticos rodarem com Postgres real;
* chaos scenarios principais forem exercitados.

==================================================
24. CRITÉRIOS TRIPLO AAA
========================

Defina três dimensões independentes.

AAA-1 — Architecture & Correctness

Exigir:

VERIFIED

para:

architecture
contracts
idempotency
event semantics
state transitions
database integrity
tests

AAA-2 — Security & Reliability

Exigir:

VERIFIED

para:

auth
authorization
webhooks
secrets
SSRF
media
rate limiting
retry
circuit breaker
DLQ
DR
container security
supply chain

AAA-3 — Operations & Observability

Exigir:

VERIFIED

para:

logging
metrics
tracing
SLO
alerts
runbook
deploy
rollback
health
readiness
performance
chaos

A certificação final só existe quando:

AAA-1 = VERIFIED
AAA-2 = VERIFIED
AAA-3 = VERIFIED

Resultado:

TRIPLE_AAA_CERTIFIED

==================================================
25. IMPLEMENTAÇÃO POR COMMITS
=============================

Não faça um mega-commit.

Separar em commits lógicos.

Sugestão:

phase-01/security-correctness
phase-02/messaging-reliability
phase-03/media-security
phase-04/authorization
phase-05/ai-safety
phase-06/observability
phase-07/platform-hardening
phase-08/supply-chain
phase-09/database
phase-10/frontend
phase-11/performance
phase-12/chaos
phase-13/lgpd
phase-14/audit
phase-15/ci-promotion
phase-16/disaster-recovery
phase-17/certification

Commits devem ser pequenos o suficiente para auditoria.

==================================================
26. REGRAS PARA EXECUÇÃO
========================

Não apenas gere recomendações.

Implemente.

Para cada fase:

1. analisar;
2. alterar código;
3. criar migrations quando necessário;
4. adicionar testes;
5. executar testes;
6. executar lint;
7. executar typecheck;
8. executar build;
9. corrigir regressões;
10. documentar evidência;
11. só então avançar.

Se encontrar algo melhor do que esta especificação:

implemente a solução tecnicamente superior,
desde que:

* preserve os objetivos;
* seja mais segura;
* seja verificável;
* documente a decisão.

Não remova funcionalidades para fazer teste passar.

Não desabilite segurança para resolver incompatibilidade.

Não use `any` indiscriminadamente.

Não silencie erro com catch vazio.

Não use `@ts-ignore` sem justificativa excepcional.

Não marque teste como skip para obter pipeline verde.

Não reduza coverage threshold para esconder regressão.

Não crie mocks que façam o teste perder valor.

==================================================
27. VALIDATION LOOP
===================

Ao final de cada fase, executar:

pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build

Quando aplicável:

pnpm test:postgres-real
pnpm test:e2e:smoke

Executar scans adicionados.

Nenhuma fase concluída com teste quebrado.

==================================================
28. FINAL CERTIFICATION
=======================

Ao terminar, gerar:

docs/TRIPLE_AAA_CERTIFICATION.md

contendo:

Executive Summary
Architecture Score
Security Score
Reliability Score
Testing Score
Observability Score
Performance Score
Operations Score
Supply Chain Score
Disaster Recovery Score

Para cada requisito:

Requirement
Status
Evidence
Test
File
Command
Result

No final:

AAA-1 Architecture & Correctness: VERIFIED / NOT VERIFIED
AAA-2 Security & Reliability: VERIFIED / NOT VERIFIED
AAA-3 Operations & Observability: VERIFIED / NOT VERIFIED

TRIPLE_AAA_CERTIFIED:
YES / NO

Não declarar YES se houver blocker.

==================================================
29. SUCCESS BLOCK MECANICAMENTE VERIFICÁVEL
===========================================

O trabalho só deve ser considerado finalizado quando este bloco puder ser preenchido com evidência real:

CVG CONNECT DESK — FINAL SUCCESS STATE

Repository:
ricardoakinaga-dev/cvg-connect-desk

Branch: <value>

Commit: <sha>

INSTALL:
PASS

LINT:
PASS

TYPECHECK:
PASS

UNIT TESTS:
PASS

INTEGRATION TESTS:
PASS

POSTGRES REAL TESTS:
PASS

CONTRACT TESTS:
PASS

E2E SMOKE:
PASS

BUILD:
PASS

MIGRATIONS FRESH DB:
PASS

MIGRATIONS UPGRADE:
PASS

WEBHOOK HMAC:
PASS

WEBHOOK ANTI-REPLAY:
PASS

INBOUND IDEMPOTENCY:
PASS

OUTBOUND IDEMPOTENCY:
PASS

SESSION TOKEN HASHING:
PASS

RBAC:
PASS

SECTOR AUTHORIZATION:
PASS

RATE LIMITING:
PASS

OUTBOX LEASING:
PASS

EXPLICIT ACK:
PASS

DLQ REPLAY:
PASS

MEDIA SECURITY:
PASS

SSRF PROTECTION:
PASS

SECRET SCAN:
PASS

SAST:
PASS

DEPENDENCY SCAN:
PASS

CONTAINER SCAN:
PASS

SBOM:
PASS

OTEL TRACING:
PASS

METRICS:
PASS

STRUCTURED LOGGING:
PASS

SLO DOCUMENTED:
PASS

CHAOS CRITICAL SCENARIOS:
PASS

BACKUP:
PASS

RESTORE TEST:
PASS

DR DOCUMENTED:
PASS

AAA-1 ARCHITECTURE & CORRECTNESS:
VERIFIED

AAA-2 SECURITY & RELIABILITY:
VERIFIED

AAA-3 OPERATIONS & OBSERVABILITY:
VERIFIED

FINAL STATUS:
TRIPLE_AAA_CERTIFIED

Se qualquer item crítico não puder ser provado:

FINAL STATUS:
NOT_YET_CERTIFIED

e liste exatamente os blockers restantes.

==================================================
30. ENTREGA FINAL
=================

Ao concluir, apresentar:

1. resumo das mudanças;
2. arquivos principais alterados;
3. migrations criadas;
4. novos testes;
5. novos workflows;
6. novos controles de segurança;
7. melhorias de observabilidade;
8. resultados dos testes;
9. resultados dos scans;
10. riscos residuais;
11. score antes/depois;
12. certificação AAA-1;
13. certificação AAA-2;
14. certificação AAA-3;
15. commit SHA final.

Não pare após análise.

Não me entregue apenas um plano.

EXECUTE TODA A MODERNIZAÇÃO POSSÍVEL NO REPOSITÓRIO.

Prioridade absoluta:

CORRECTNESS
SECURITY
RELIABILITY
OBSERVABILITY
TESTABILITY
OPERABILITY

Objetivo final:

entregar o CVG Connect Desk como uma plataforma de atendimento digital veterinário State of Art, Triplo AAA, resiliente, segura, auditável e pronta para operação crítica real. . Me entregue um programa State of Art, Triplo AAA de qualidade.

---

**Metadados de arquivamento:**
- Origem: mensagem do usuário em 2026-09-12
- Arquivo: `docs/72-prompt-modernizacao-triplo-aaa.md`
- Relatório de auditoria anterior: `docs/71-relatorio-auditoria-completa-notas-0-100.md` (média 63)
