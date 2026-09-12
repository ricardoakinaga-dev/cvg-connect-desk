# Prompt de Certificação Final — Release Certification Closure

> Cópia fiel do prompt fornecido pelo usuário, salva em `docs/` para rastreabilidade.
> Arquivo: `docs/74-prompt-release-certification-closure.md`
> Estado anterior: `docs/TRIPLE_AAA_CERTIFICATION.md` (AAA-1 VERIFIED, AAA-2/3 CONDITIONAL, NOT_YET_CERTIFIED)

---

Você está atuando como Principal Engineer, Staff Software Architect, Security Engineer, SRE, Platform Engineer, Reliability Engineer e Release Certification Engineer.

Sua missão é realizar a etapa final de promoção do repositório:

https://github.com/ricardoakinaga-dev/cvg-connect-desk

OBJETIVO FINAL

Levar o projeto do estado atual:

STATE OF ART CANDIDATE
AAA-1 VERIFIED
AAA-2 CONDITIONAL
AAA-3 CONDITIONAL
NOT_YET_CERTIFIED

para:

STATE OF ART
TRIPLE AAA
PRODUCTION-GRADE
SECURITY-VERIFIED
RESILIENCE-VERIFIED
OBSERVABILITY-VERIFIED
DISASTER-RECOVERY-VERIFIED
MECHANICALLY CERTIFIED

Não faça uma reescrita.

Não refatore módulos já maduros apenas por preferência estética.

Preserve todas as garantias atualmente VERIFIED.

O foco agora é:

1. fechar lacunas técnicas residuais;
2. executar evidências reais;
3. consolidar promotion gates;
4. eliminar ambiguidades de certificação;
5. emitir certificação somente se todos os requisitos forem comprovados.

==================================================

1. ESTADO ATUAL A PRESERVAR
   ==================================================

Considere como baseline existente:

* arquitetura modular;
* Fastify + TypeScript;
* React + Vite;
* PostgreSQL + Drizzle;
* Redis;
* workers;
* realtime;
* outbox;
* lease + ACK explícito;
* persistent DLQ PostgreSQL;
* inbound idempotency;
* outbound idempotency;
* messaging contracts versionados;
* bounded retry;
* HMAC sobre raw body;
* webhook anti-replay;
* canonical message IDs;
* session token hashing;
* rotation;
* logout-all;
* CORS fail-secure;
* rate limiting segmentado;
* readiness real;
* RBAC;
* sector zero-trust;
* contextual authorization;
* append-only audit;
* AI policy deny-by-default;
* AI tool registry com 5 classes;
* human approval flow;
* MIME validation;
* file-size validation;
* SSRF protections;
* S3-compatible media abstraction;
* malware scanner abstraction;
* quarantine;
* ClamAV integration;
* OpenTelemetry SDK;
* W3C trace context;
* structured logs;
* PII/secret redaction;
* Prometheus metrics;
* SLOs;
* k6;
* chaos/resilience tests;
* hardened containers;
* CodeQL workflow;
* Gitleaks workflow;
* Trivy workflow;
* SBOM workflow;
* dependency review;
* migration validation;
* realtime multi-replica via Redis;
* backup tooling;
* restore tooling;
* DSAR/export/anonymization;
* architecture/security/runbook/DR documentation;
* Triple AAA verification tooling.

Antes de qualquer alteração:

rode o baseline atual e registre commit SHA + resultados.

==================================================
2. FASE 0 — BASELINE REVALIDATION
=================================

Execute:

pnpm install --frozen-lockfile

pnpm lint

pnpm typecheck

pnpm test

pnpm test:postgres-real

pnpm test:e2e:smoke

pnpm build

pnpm triple-aaa:verify

Registre:

repository
branch
commit SHA
Node version
pnpm version
PostgreSQL version
Redis version

Registre também:

total de testes
tests passed
tests failed
coverage
security audit
migration state

Nenhum VERIFIED anterior pode regredir.

==================================================
3. FECHAR O GATE DE CERTIFICAÇÃO
================================

Atualmente existem verificações distribuídas entre vários workflows.

Crie um mecanismo único e inequívoco de promoção.

O estado final de um commit deve depender de TODOS os required checks.

O aggregate gate deve considerar:

critical build gate
unit tests
integration tests
PostgreSQL real
Redis real
migration fresh DB
migration upgrade
contract tests
E2E browser
CodeQL
Gitleaks
Trivy
Dependency Review
SBOM
DR E2E
coverage
security audit
load test quando configurado como release gate

Criar ou melhorar:

.github/workflows/triple-aaa-certification.yml

Fluxo:

all required workflows
↓
certification aggregator
↓
FAILED
ou
VERIFIED_CANDIDATE

Nunca promover apenas porque alguns workflows estão verdes.

==================================================
4. REQUIRED CHECKS
==================

Defina explicitamente required gates.

Critérios mínimos:

lint = PASS

typecheck = PASS

unit = PASS

integration = PASS

postgres-real = PASS

contracts = PASS

migrations-fresh = PASS

migrations-upgrade = PASS

e2e-browser = PASS

build = PASS

codeql = PASS

gitleaks = PASS

trivy = PASS

dependency-review = PASS

sbom = PASS

dr-e2e = PASS

coverage = PASS

critical-security-audit = PASS

Se um check estiver ausente:

estado não pode ser VERIFIED.

Ausência de evidência = NOT VERIFIED.

==================================================
5. DR E2E REAL
==============

O restore deve ser realmente executado.

Não aceitar apenas script válido.

Rodar fluxo real:

create DB
→ migrations
→ representative fixture
→ backup
→ checksum
→ destroy DB
→ recreate DB
→ restore
→ validate schema
→ validate data
→ boot application
→ smoke test

Validar ao menos:

users
sessions
contacts
conversations
messages
outbox
dead_letter_events
audit
media metadata
AI approvals

Comparar valores esperados antes/depois.

Produzir artifact:

artifacts/dr-e2e-report.json

Com:

backup_started_at
backup_finished_at
backup_size
checksum
restore_started_at
restore_finished_at
restore_duration
integrity_checks
smoke_result
RPO
RTO
result

==================================================
6. STAGING REAL PARA INTEGRAÇÕES EXTERNAS
=========================================

Criar perfil de staging reproduzível.

Preferencialmente:

docker-compose.staging.yml

ou equivalente.

Subir:

PostgreSQL
Redis
MinIO
ClamAV
OpenTelemetry Collector
Desk API
Worker
Realtime
Desk Web

Quando tecnicamente razoável, adicionar:

Prometheus
Grafana
Jaeger ou Tempo

Staging deve provar integrações que hoje estão verificadas apenas por fake/mock.

==================================================
7. S3/MINIO REAL
================

Executar smoke real do driver S3-compatible.

Usar MinIO no CI/staging.

Testar:

bucket creation/precondition
upload
exists
download
signed URL
delete
metadata
SHA-256
large-file boundary
invalid credentials
storage unavailable
timeout

Adicionar integration tests com MinIO real.

Não substituir unit tests; complementar.

==================================================
8. CLAMAV REAL
==============

Subir `clamd` real em staging/CI.

Executar:

clean file
EICAR test file
scanner timeout
scanner unavailable

Comportamento esperado:

clean
→ media promoted

infected
→ quarantine / blocked

scanner unavailable em política fail-secure
→ media NOT available

Produzir evidência.

Adicionar health/readiness específico para malware scanner quando o scanner for dependência obrigatória.

==================================================
9. OTEL COLLECTOR REAL
======================

Subir OpenTelemetry Collector real.

Executar uma transação end-to-end:

webhook
→ desk-api
→ DB
→ outbox
→ worker
→ gateway/secretary mock or test endpoint
→ realtime

Validar que os spans chegam ao Collector.

Verificar correlação:

trace_id
event_id
message_id
conversation_id
correlation_id
causation_id

Verificar W3C:

traceparent

entre serviços.

Gerar uma assertion automática.

Exemplo:

expected service spans:

desk-api
message-worker
realtime-service

e external client spans quando aplicável.

==================================================
10. OBSERVABILITY STACK
=======================

Garantir que o sistema possa ser operado em produção.

Adicionar ou consolidar dashboards:

System Overview
Messaging
Outbox
DLQ
Webhook Security
Authentication
Database
Redis
Realtime
Media
AI
External Providers

Alertas mínimos:

DLQ > threshold

oldest_outbox_event_age > threshold

webhook rejection spike

message processing error rate

database unavailable

redis unavailable

gateway failure rate

worker backlog

media scanner unavailable

S3 unavailable

API 5xx spike

P95 above SLO

==================================================
11. SLO / ERROR BUDGET
======================

Revisar SLOs com base nos testes medidos.

Não usar números arbitrários.

Definir:

availability SLO
message acceptance SLO
message processing latency
realtime delivery latency
outbound enqueue latency
duplicate side-effect tolerance
message-loss tolerance

Produzir error budget.

Exemplo:

availability target
99.9%

monthly error budget
~43m49s

Mas calcule com os valores realmente adotados.

==================================================
12. SECURITY WORKFLOW FINALIZATION
==================================

Executar de verdade:

CodeQL
Gitleaks
Trivy
Dependency Review
pnpm audit
SBOM

Não aceitar workflow apenas existente.

Registrar resultado por SHA.

Trivy deve falhar em:

CRITICAL
HIGH runtime exploitable

conforme policy.

CodeQL:

resolver findings relevantes.

Gitleaks:

zero secrets reais.

SBOM:

gerar artifact versionado.

==================================================
13. VULNERABILITY POLICY
========================

Revalidar:

docs/SECURITY_VULNERABILITY_TRIAGE.md

Nenhuma vulnerabilidade:

CRITICAL

ou:

HIGH runtime + reachable

pode permanecer sem mitigação comprovada.

Para findings aceitos:

owner
justification
expiry
compensating control

Automatizar verificação de expiry se razoável.

==================================================
14. SUPPLY-CHAIN HARDENING
==========================

Avaliar e implementar quando adequado:

pin GitHub Actions por SHA
lockfile integrity
SBOM generation
artifact checksum
container digest
build provenance
SLSA provenance quando viável
signed release artifacts

Avaliar Cosign.

Se implementar:

assinar imagens de release.

Documentar verification command.

==================================================
15. CONTAINER RELEASE HARDENING
===============================

Revalidar Dockerfiles.

Garantir:

non-root
read_only
cap_drop ALL
no-new-privileges
minimal image
no unnecessary packages
healthchecks corretos
tmpfs para paths mutáveis
no secrets baked into images

Executar Trivy nos principais containers:

desk-api
message-worker
realtime-service
desk-web

Não verificar apenas um container.

==================================================
16. REALTIME RESILIENCE FINAL
=============================

A arquitetura multi-réplica já existe.

Agora validar cenários:

2 replicas
3 replicas

node A publishes
node B client receives

node B dies
remaining nodes continue

Redis temporary disconnect
reconnect
no silent loss where outbox durable fallback applies

duplicate pubsub event
dedup works

graceful shutdown

Criar integration suite.

==================================================
17. PERSISTENT DLQ ADVANCED VALIDATION
======================================

Revalidar DLQ com cenários adversariais:

process kill after claim

process kill before replay commit

concurrent replay

same event replayed by two operators

corrupt payload

poison message

100-event batch

retry loop prevention

Garantir state machine válida.

Exemplo:

PENDING
→ REPLAYING
→ RESOLVED

ou:

PENDING
→ REPLAYING
→ PENDING

em erro retentável.

Nunca estado impossível.

==================================================
18. MEDIA SECURITY FINAL
========================

Adicionar se faltante:

MIME sniffing independente de extension/content-type

magic byte validation

filename sanitization

content-disposition safety

signed URL expiration

maximum file limits por tipo

download timeout

redirect limit

DNS rebinding defense

private IP revalidation após DNS resolution

peer IP verification quando possível

Não confiar só no hostname validado antes da conexão.

==================================================
19. AI SAFETY FINAL
===================

Revalidar que:

READ_ONLY
SAFE_WRITE
SENSITIVE_WRITE
HUMAN_APPROVAL
FORBIDDEN

estão enforced.

Testar bypasses:

tool alias
case variation
unknown tool
malformed action
direct internal function invocation

Unknown action:

FORBIDDEN by default.

Human approval:

approval deve estar ligado a:

exact action
exact arguments/hash
actor
expiry

Alterar argumentos após aprovação:

deve invalidar approval.

==================================================
20. AUTH / SESSION FINAL HARDENING
==================================

Revalidar:

token hashing
idle timeout
absolute timeout
rotation
logout-all
revocation

Adicionar quando apropriado:

session family
rotation replay detection

Testar:

revoked token
expired token
inactive user
role changed while session active
sector removed while session active

Permissões devem refletir estado atual do banco.

==================================================
21. DATABASE PRODUCTION HARDENING
=================================

Revisar:

connection pool
query timeout
statement timeout
lock timeout
idle transaction timeout

Indexes:

confirmar EXPLAIN em hot paths.

Identificar:

N+1
sequential scans inesperados
slow joins

Criar query-performance evidence para hot paths.

==================================================
22. LOAD TEST FINAL
===================

Executar:

10 VUs
50 VUs
100 VUs

Se ambiente permitir:

250 VUs como stress exploratório.

Cenários:

webhook burst
conversation list
message pagination
send message
contacts search
realtime fanout

Registrar:

RPS
P50
P95
P99
error rate
CPU
memory
DB pool
Redis latency
worker backlog
outbox oldest age

Não exigir artificialmente que 250 VUs passe SLO de produção.

Distinguir:

load
stress
breakpoint

==================================================
23. CHAOS FINAL
===============

Cobrir:

Postgres down
Redis down
S3 down
ClamAV down
OTEL Collector down
Gateway timeout
Gateway 429
Gateway 500
Secretary down
worker killed
realtime node killed

OTEL Collector indisponível:

não pode derrubar atendimento.

Observability deve ser non-critical dependency.

ClamAV:

seguir fail-secure conforme media policy.

S3:

mensagem textual deve continuar funcionando se media subsystem estiver degradado.

==================================================
24. E2E BROWSER REAL
====================

Executar Playwright no CI.

Cobrir:

login
logout
Inbox
conversation open
send message
contact
Kanban
task
sector authorization
admin authorization
session expiry
realtime reconnect

Gerar:

trace
screenshot on failure
video on failure opcional
HTML report

==================================================
25. PRODUCTION READINESS CHECK
==============================

Criar:

pnpm production-readiness

Validar configuração antes de deploy.

Checar:

NODE_ENV
DATABASE_URL
REDIS_URL
CORS_ORIGIN
WEBHOOK_SECRET
JWT/session config
MEDIA_STORAGE_DRIVER
S3 config
MALWARE scanner config
OTEL config
bootstrap admin disabled
no dev bypass
no fake scanner
no memory storage if forbidden
no wildcard CORS
no insecure secrets

Produção mal configurada:

fail fast.

==================================================
26. RELEASE ARTIFACT
====================

Gerar:

artifacts/triple-aaa-report.json

e:

artifacts/triple-aaa-report.md

Conteúdo:

commit
branch
timestamp
tool versions
all gates
test totals
coverage
security results
DR results
performance results
staging smoke
AAA statuses

Tudo deve apontar para evidência reproduzível.

==================================================
27. CERTIFICATION RULE
======================

(ver seção 27 do prompt original — critérios AAA-1/2/3 por item)

==================================================
28. PROMOTION STATES
====================

Use somente:

FAILED
CONDITIONAL
VERIFIED_CANDIDATE
TRIPLE_AAA_CERTIFIED

Regras:

FAILED: critical gate failed.
CONDITIONAL: core passes, external evidence incomplete.
VERIFIED_CANDIDATE: todos os gates passaram no SHA atual.
TRIPLE_AAA_CERTIFIED: VERIFIED_CANDIDATE + release approval/tag.

==================================================
29. TAG DE CERTIFICAÇÃO
=======================

Não criar automaticamente se não houver evidência.
Nunca mover a tag posteriormente. Nova versão: triple-aaa-v1.1 / v2.

==================================================
30. GITHUB BRANCH PROTECTION
============================

Se possível via configuração/repositório, documentar required checks recomendados para main.
Separar: PR gates / release gates / scheduled assurance gates.

==================================================
31. PR GATES VS RELEASE GATES
=============================

(ver seção 31 do prompt original)

==================================================
32. DOCUMENTATION FINAL
=======================

Atualizar: README.md, docs/TRIPLE_AAA_CERTIFICATION.md, docs/TEST_MATRIX.md,
docs/SECURITY.md, docs/OBSERVABILITY.md, docs/DISASTER_RECOVERY.md,
docs/PRODUCTION_DEPLOYMENT.md, docs/RUNBOOK.md, docs/SLO.md,
docs/SECURITY_VULNERABILITY_TRIAGE.md.

Nenhuma documentação pode declarar PASS sem evidência.

==================================================
33. FINAL SUCCESS BLOCK
=======================

(ver seção 33 do prompt original — bloco mecanicamente verificável)

==================================================
34. HONESTY RULE
================

Nunca confunda: implemented com verified; unit-tested com
production-integrated; workflow exists com workflow passed;
restore script exists com restore succeeded; OTEL SDK configured com
collector received traces. Se faltar evidência: CONDITIONAL.

==================================================
35. EXECUTION RULES
===================

Não me entregue apenas um plano. Implemente, execute, corrija, reexecute.
Não remova garantias para obter verde. Não desabilite gates. Não faça skip
silencioso. Não aceite fail-open crítico. Não reduza coverage artificialmente.
Não esconda findings. Não altere certificação manualmente sem evidência.

==================================================
36. PRIORIDADE
==============

1. certification aggregator;
2. DR E2E real;
3. MinIO real;
4. ClamAV real;
5. OTEL Collector real;
6. E2E Browser real;
7. CodeQL/Gitleaks/Trivy/SBOM execution;
8. production-readiness gate;
9. final evidence artifact;
10. promotion/tag.

==================================================
37. RESULTADO FINAL DESEJADO
============================

AAA-1 VERIFIED · AAA-2 VERIFIED · AAA-3 VERIFIED · FINAL TRIPLE_AAA_CERTIFIED
somente quando cada afirmação estiver sustentada por evidência executada no SHA
exato da release. Não fazer o relatório dizer que é Triple AAA; fazer o software
PROVAR que é Triple AAA.

Comece agora pela revalidação do baseline, feche todas as evidências pendentes,
execute a certification closure e somente então promova o commit.

---

**Metadados de arquivamento:**
- Origem: mensagem do usuário
- Arquivo: `docs/74-prompt-release-certification-closure.md`
