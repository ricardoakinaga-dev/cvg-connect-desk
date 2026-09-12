# Prompt de Certificação Final — Triple AAA Closure

> Cópia fiel do prompt fornecido pelo usuário, salva em `docs/` para rastreabilidade.
> Arquivo: `docs/73-prompt-certificacao-final-triple-aaa.md`

---

Você está atuando como Principal Engineer, Staff Backend Engineer, Staff Frontend Engineer, Security Engineer, SRE, Platform Engineer, Reliability Engineer, Database Engineer e Software Architect.

Sua missão é realizar a **FINAL TRIPLE AAA CERTIFICATION CLOSURE** no repositório:

https://github.com/ricardoakinaga-dev/cvg-connect-desk

OBJETIVO FINAL

Elevar o projeto de:

STATE OF ART CANDIDATE
AAA-1 VERIFIED
AAA-2 CONDITIONAL
AAA-3 CONDITIONAL

para:

STATE OF ART
TRIPLE AAA
PRODUCTION-GRADE
SECURITY-HARDENED
FAILURE-RESILIENT
FULLY OBSERVABLE
DISASTER-RECOVERABLE
MECHANICALLY VERIFIED

Não reescreva o sistema.

Não refatore módulos já estáveis sem necessidade.

Não degrade nenhuma garantia que já está VERIFIED.

A prioridade é fechar blockers reais, consolidar evidência e promover o sistema com segurança.

==================================================

1. ESTADO ATUAL A PRESERVAR
   ==================================================

Considere como baseline existente e não regredir:

* arquitetura modular;
* Fastify + TypeScript;
* React + Vite;
* PostgreSQL + Drizzle;
* Redis;
* workers;
* realtime;
* outbox;
* lease + ACK explícito;
* idempotência inbound;
* idempotência outbound;
* contratos versionados;
* retry bounded;
* HMAC em raw body;
* anti-replay;
* canonical message IDs;
* session hashing;
* session rotation;
* logout-all;
* CORS fail-secure;
* rate limiting segmentado;
* readiness real;
* RBAC;
* autorização contextual por setor;
* default-deny;
* audit trail;
* AI policy deny-by-default;
* media MIME validation;
* media size limits;
* SSRF protections;
* redaction;
* métricas;
* k6;
* resilience tests;
* container hardening;
* CodeQL workflow;
* Gitleaks workflow;
* Trivy workflow;
* CycloneDX SBOM;
* migration checking;
* frontend realtime backoff;
* heartbeat;
* stale connection detection;
* backup scripts;
* restore scripts;
* documentação de arquitetura;
* threat model;
* SLOs;
* runbook;
* matriz de testes;
* certificação AAA honesta.

Antes de alterar código, rode e registre o baseline atual.

==================================================
2. BLOCKERS DE CERTIFICAÇÃO A FECHAR
====================================

Trate estes itens como blockers prioritários:

1. DLQ ainda não persistente;
2. ausência de OpenTelemetry distribuído;
3. mídia sem object storage durável;
4. ausência de malware/quarantine pipeline;
5. restore de backup não validado ponta a ponta;
6. CI de segurança/E2E sem evidência real consolidada;
7. vulnerabilidades HIGH transitivas ainda não triadas formalmente;
8. realtime ainda com limitações de single-replica;
9. LGPD export/delete tooling ainda parcial.

Nenhum desses blockers deve ser simplesmente documentado como aceito sem análise técnica real.

==================================================
3. FASE 0 — REVALIDAÇÃO DO BASELINE
===================================

Antes de implementar qualquer coisa:

* inspecione main;
* leia docs/TRIPLE_AAA_CERTIFICATION.md;
* leia docs/TEST_MATRIX.md;
* leia workflows;
* leia migrations;
* leia DLQ atual;
* leia realtime-service;
* leia media pipeline;
* leia observability;
* leia backup/restore;
* leia security workflow.

Execute quando possível:

pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:postgres-real
pnpm test:e2e:smoke
pnpm build

Registre:

branch
commit SHA
test totals
failures
warnings
security findings

Se algum VERIFIED atual estiver quebrado, corrija antes de avançar.

==================================================
4. PHASE FINAL-1 — PERSISTENT DEAD LETTER QUEUE
===============================================

Este é blocker crítico.

A DLQ não pode perder eventos após restart.

Crie uma implementação persistente usando PostgreSQL.

Tabela sugerida:

dead_letter_events

Campos mínimos:

id UUID
original_event_id
consumer_id
event_type
payload JSONB
error_code
error_message
attempt_count
first_failed_at
last_failed_at
status
replay_count
replayed_at
resolved_at
resolved_by
resolution_reason
created_at
updated_at

Status sugeridos:

PENDING
REPLAYING
RESOLVED
DISCARDED

Requisitos:

* payload durável;
* unique constraints apropriadas;
* índices por status/date/consumer/type;
* inserts transacionais;
* nenhum evento perdido;
* replay idempotente;
* concorrência segura;
* manual replay auditado;
* batch replay auditado;
* discard auditado;
* resolve auditado.

Criar API operacional:

GET /dead-letter
GET /dead-letter/:id
POST /dead-letter/:id/replay
POST /dead-letter/replay-batch
POST /dead-letter/:id/resolve
POST /dead-letter/:id/discard

Aplicar:

authentication
authorization
sensitive action policy
audit trail

Criar testes reais com PostgreSQL:

* persist failure;
* restart/recreate repository and recover event;
* replay success;
* replay failure;
* duplicate replay;
* concurrent replay;
* batch replay;
* audit entry;
* resolved item excluded from pending;
* corrupted payload handling.

Critério de sucesso:

process restart NÃO perde DLQ.

==================================================
5. PHASE FINAL-2 — OPENTELEMETRY END-TO-END
===========================================

Implementar OpenTelemetry de verdade.

Instrumentar:

desk-api
message-worker
realtime-service
gateway client
Secretary client
PostgreSQL
Redis
HTTP outbound

Adicionar SDK oficial OpenTelemetry.

Suportar OTLP exporter por environment.

Exemplo:

OTEL_ENABLED=true
OTEL_SERVICE_NAME
OTEL_EXPORTER_OTLP_ENDPOINT
OTEL_EXPORTER_OTLP_HEADERS
OTEL_RESOURCE_ATTRIBUTES

Em desenvolvimento/test:

exporter pode ser disabled ou in-memory.

Produção:

configurável para Collector.

Propagar W3C Trace Context:

traceparent
tracestate

Propagar também:

correlation_id
causation_id
event_id
message_id
conversation_id

Adicionar SDK oficial OpenTelemetry. (requisito reiterado no prompt original)

Suportar OTLP exporter por environment. (requisito reiterado no prompt original)

Propagar W3C Trace Context (requisito reiterado):

traceparent
tracestate

Criar spans relevantes:

webhook.receive
message.persist
outbox.publish
outbox.claim
worker.process
gateway.send
gateway.receive
secretary.invoke
realtime.publish
dlq.persist
dlq.replay

Capturar:

duration
status
error type
retry count

Não registrar secrets.

Criar testes:

* trace context propagation;
* child span creation;
* outgoing HTTP traceparent;
* event correlation preserved;
* error span status;
* redaction remains intact.

Atualizar docs/OBSERVABILITY.md.

==================================================
6. PHASE FINAL-3 — OBJECT STORAGE PARA MÍDIA
============================================

Criar abstração:

MediaStorage

Interface sugerida:

put()
get()
delete()
exists()
createSignedReadUrl()

Implementação inicial:

S3-compatible

Compatível com:

MinIO
AWS S3
Cloudflare R2

Não acoplar domínio a um provider específico.

Variáveis:

MEDIA_STORAGE_DRIVER
S3_ENDPOINT
S3_REGION
S3_BUCKET
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
S3_FORCE_PATH_STYLE

Para desenvolvimento:

permitir MinIO.

Não usar filesystem local como storage final de produção.

Fluxo inbound:

validate metadata
→ controlled fetch
→ malware quarantine
→ SHA-256
→ object storage
→ persist metadata
→ make available

Pipeline sugerido (requisito reiterado): validate → fetch → quarantine → hash → store → metadata.

Fluxo outbound:

authorize
→ object lookup
→ signed access/fetch
→ provider send

Schema de mídia:

media_id
message_id
storage_driver
storage_bucket
storage_key
sha256
mime_type
size_bytes
filename
scan_status
storage_status
created_at
retention_until

==================================================
7. PHASE FINAL-4 — MALWARE SCANNING / QUARANTINE
================================================

Adicionar pipeline seguro.

Estados:

PENDING_SCAN
CLEAN
INFECTED
SCAN_FAILED
QUARANTINED

Não disponibilizar mídia para operadores enquanto:

scan_status != CLEAN

Criar abstraction:

MalwareScanner

Implementação inicial pode usar:

ClamAV daemon
ou integração equivalente.

Em dev/test:

FakeScanner explícito e nunca habilitado silenciosamente em production.

Produção sem scanner configurado:

fail-secure para tipos de arquivo que exigem scan.

Políticas:

images
audio
video
documents

Documentos devem receber política mais restritiva.

Adicionar timeout para scanner.

Nenhum arquivo infectado deve chegar ao object storage público.

Se armazenado antes do scan:

usar prefixo quarantine/.

Após CLEAN:

promover para media/.

INFECTED:

manter quarentena com retenção curta ou excluir conforme política.

Adicionar testes:

clean
infected
timeout
scanner unavailable
oversized file
invalid MIME
polyglot/mismatch detection quando possível

==================================================
8. PHASE FINAL-5 — RESTORE TEST PONTA A PONTA
=============================================

Backup só conta se restore for provado.

Criar workflow automatizado, idealmente scheduled.

Fluxo:

1. subir PostgreSQL limpo;
2. executar migrations;
3. inserir fixture representativa;
4. gerar backup;
5. calcular checksum;
6. destruir banco;
7. criar banco novo;
8. restaurar backup;
9. validar checksum/estrutura;
10. executar integrity queries;
11. iniciar aplicação;
12. executar smoke test;
13. comparar fixture restaurada.

Validar:

users
sessions
contacts
conversations
messages
outbox
DLQ
audit

Criar script:

infra/scripts/dr-e2e.sh

ou equivalente.

Falhar CI se restore falhar.

Registrar duração.

Atualizar:

DISASTER_RECOVERY.md

Definir formalmente:

RPO
RTO

==================================================
9. PHASE FINAL-6 — SECURITY WORKFLOWS EXECUTÁVEIS
=================================================

Garantir que todos os workflows rodem corretamente em GitHub Actions.

Obrigatórios:

CodeQL
Gitleaks
Trivy
Dependency Review
pnpm audit
SBOM
E2E Browser
Postgres Real
Migration Check

Verificar permissões.

Verificar paths.

Verificar cache.

Verificar SARIF upload.

Verificar que failures realmente quebram o job.

Trivy:

HIGH e CRITICAL devem ser avaliados.

Não gerar SARIF e depois ignorar exit code crítico.

Configurar policy explícita.

Garantir que failures realmente quebram o job. (requisito reiterado no prompt original)

Adicionar workflow de agregação:

triple-aaa-gate.yml

que dependa ou replique checks obrigatórios.

==================================================
10. PHASE FINAL-7 — VULNERABILITY TRIAGE
========================================

As vulnerabilidades HIGH restantes precisam de triagem formal.

Gerar:

docs/SECURITY_VULNERABILITY_TRIAGE.md

Para cada finding:

package
version
CVE/advisory
severity
direct/transitive
dev/runtime
reachable?
exploit path
fixed version
mitigation
decision
owner
expiry

Categorias permitidas:

FIXED
NOT_REACHABLE
TEMPORARILY_ACCEPTED

TEMPORARILY_ACCEPTED exige:

justificativa
owner
data de expiração
compensating control

Nenhuma HIGH runtime/reachable sem mitigação pode permanecer para AAA-2 VERIFIED.

Atualizar dependências quando seguro.

Não realizar upgrade major destrutivo sem testes.

==================================================
11. PHASE FINAL-8 — REALTIME MULTI-REPLICA
==========================================

Remover dependência de fanout puramente local em memória.

Usar backend compartilhado.

Como Redis já existe, preferir:

Redis Pub/Sub
ou Redis Streams

Escolher tecnicamente o mais adequado.

Requisitos:

API/worker publica evento
→ Redis
→ todos realtime-service recebem
→ apenas clientes relevantes recebem

Suportar múltiplas réplicas.

Evitar duplicate broadcast indevido.

Criar:

instanceId
eventId
dedup cache se necessário

WebSocket state continua local por node, mas eventos são distribuídos.

Adicionar graceful shutdown:

stop accepting
close subscriptions
drain
close sockets

Adicionar testes com duas instâncias simuladas ou reais:

node A receives client
node B publishes
client on A receives event

e inverso.

==================================================
12. PHASE FINAL-9 — LGPD / DSAR TOOLING
=======================================

Criar suporte operacional mínimo para direitos de dados.

Implementar abstrações ou endpoints administrativos para:

export contact data
anonymize/delete eligible contact data

Nunca apagar dados que precisem permanecer por obrigação legal/operacional sem política.

Criar DataSubjectService.

Export deve incluir:

contact
conversations
messages where eligible
notes where eligible
groups
labels
audit references as allowed

Delete/anonymize deve respeitar retention policy.

Preferir anonymization quando histórico operacional precisa ser preservado.

Registrar:

actor
reason
request id
scope
result
timestamp

Implementar abstrações ou endpoints administrativos para export/anonymize. (requisito reiterado)

Registrar actor/reason/request/scope/result/timestamp. (requisito reiterado)

Adicionar autorização forte e audit.

Criar documentação:

docs/LGPD_DATA_SUBJECT_REQUESTS.md

==================================================
13. PHASE FINAL-10 — AI SAFETY COMPLETION
=========================================

Evoluir policy atual de IA para:

READ_ONLY
SAFE_WRITE
SENSITIVE_WRITE
HUMAN_APPROVAL
FORBIDDEN

Definir ações concretas.

Exemplos:

READ_ONLY:
buscar contato
ler agenda permitida

SAFE_WRITE:
registrar nota operacional de baixo risco

SENSITIVE_WRITE:
alterar dados cadastrais importantes
transferir conversa em certos contextos

HUMAN_APPROVAL:
ações financeiras
exclusões
mudanças críticas
operações clínicas sensíveis se existirem

FORBIDDEN:
permissions
security configuration
secret access
audit tampering

Adicionar enforcement real.

Não deixar classificação apenas documental.

==================================================
14. PHASE FINAL-11 — PERFORMANCE HARDENING
==========================================

Expandir carga atual.

Executar cenários:

10 VUs
50 VUs
100 VUs

e burst inbound.

Cenários:

webhook inbound
conversation list
message list
message send
contacts search
realtime fanout

Medir:

P50
P95
P99
error rate
throughput
DB connections
worker backlog
outbox age
Redis latency

Não definir SLO impossível.

Atualizar baseline real.

Criar regressão de performance com thresholds razoáveis.

==================================================
15. PHASE FINAL-12 — CHAOS COMPLETION
=====================================

Adicionar cenários faltantes:

Postgres unavailable
Redis unavailable
Gateway 500
Gateway 429
Gateway timeout
Secretary timeout
worker killed after claim
worker killed after external provider response
realtime Redis disconnect
object storage unavailable
malware scanner unavailable

Critério:

nenhuma mensagem desaparece silenciosamente.

Toda falha termina em um dos estados:

retry scheduled
dead letter
degraded
terminal explicit failure

Nunca:

unknown silent state

==================================================
16. ARCHITECTURE DECISION RECORDS
=================================

Criar ADRs relevantes:

ADR-001 Persistent DLQ
ADR-002 OpenTelemetry
ADR-003 Media Object Storage
ADR-004 Malware Quarantine
ADR-005 Realtime Fanout
ADR-006 DR Verification

Cada ADR:

Context
Decision
Alternatives
Consequences
Security impact
Operational impact

==================================================
17. TEST COVERAGE
=================

Preserve os 665+ testes existentes.

Todos os novos componentes devem ser cobertos.

Prioridade alta para:

DLQ
OTEL context
media storage
malware scanner
restore
realtime fanout
DSAR
AI human-approval

Coverage global não pode regredir significativamente.

Criar gates mínimos se ainda não existirem.

Sugestão:

statements >= 85
branches >= 80
functions >= 85
lines >= 85

Coverage global não pode regredir significativamente. (requisito reiterado)

Sugestão de thresholds reiterada: statements >= 85, branches >= 80, functions >= 85, lines >= 85.

Não reduza threshold para fazer CI passar.

==================================================
18. MUTATION TESTING SE VIÁVEL
==============================

Adicionar mutation testing apenas para módulos críticos:

webhook guard
authorize
retry policy
idempotency
DLQ state transitions

Se custo for alto demais:

documentar benchmark e decisão.

Mutation testing não deve quebrar o projeto por tempo absurdo, mas deve ser avaliado seriamente.

==================================================
19. TRIPLE AAA MASTER GATE
==========================

Criar um script único:

pnpm triple-aaa:verify

Esse comando deve executar ou orquestrar:

lint
typecheck
unit
integration
postgres-real
contract
migration-check
e2e
build
coverage
security local checks possíveis
architecture checks
DR local checks possíveis

Para checks dependentes de GitHub:

validar evidência via CI status/documentação gerada.

Gerar artifact:

artifacts/triple-aaa-report.json

Formato sugerido:

{
"commit": "...",
"timestamp": "...",
"gates": {
"lint": "PASS",
...
},
"aaa1": "VERIFIED",
"aaa2": "VERIFIED",
"aaa3": "VERIFIED",
"final": "TRIPLE_AAA_CERTIFIED"
}

Não gerar VERIFIED artificialmente.

==================================================
20. AAA-1 CRITÉRIO FINAL
========================

AAA-1 — Architecture & Correctness só pode permanecer VERIFIED se:

architecture tests pass
contracts pass
idempotency pass
database integrity pass
outbox semantics pass
DLQ durability pass
migrations pass
all critical tests pass

==================================================
21. AAA-2 CRITÉRIO FINAL
========================

AAA-2 — Security & Reliability só pode ser VERIFIED se:

raw HMAC verified
anti-replay verified
auth hashing verified
authorization verified
sector zero-trust verified
media SSRF verified
malware pipeline verified
object storage security verified
rate limiting verified
bounded retry verified
persistent DLQ verified
DR restore verified
CodeQL executed successfully
Gitleaks executed successfully
Trivy policy passed
dependency review passed
runtime HIGH vulnerabilities resolved/mitigated
secret handling verified

==================================================
22. AAA-3 CRITÉRIO FINAL
========================

AAA-3 — Operations & Observability só pode ser VERIFIED se:

structured logging verified
redaction verified
metrics verified
OpenTelemetry verified
trace propagation verified
SLOs verified
runbook complete
realtime multi-replica verified
health/readiness verified
backup/restore verified
load test verified
chaos test verified
rollback documented
deployment documented

==================================================
23. CI PROMOTION STATES
=======================

Definir estados formais:

FAILED
CONDITIONAL
VERIFIED_CANDIDATE
TRIPLE_AAA_CERTIFIED

Merge para main somente quando critical gates passarem.

Definir estados formais (requisito reiterado): FAILED, CONDITIONAL, VERIFIED_CANDIDATE, TRIPLE_AAA_CERTIFIED.

Criar, se apropriado:

git tag

triple-aaa-v1

somente após aprovação dos gates.

Não criar tag se qualquer blocker permanecer.

==================================================
24. DOCUMENTAÇÃO FINAL
======================

Atualizar:

README.md
ARCHITECTURE.md
SECURITY.md
AUTHORIZATION.md
MESSAGING_CONTRACTS.md
OBSERVABILITY.md
SLO.md
RUNBOOK.md
DISASTER_RECOVERY.md
AI_SAFETY.md
PRODUCTION_DEPLOYMENT.md
THREAT_MODEL.md
TEST_MATRIX.md
TRIPLE_AAA_CERTIFICATION.md

Criar:

SECURITY_VULNERABILITY_TRIAGE.md
LGPD_DATA_SUBJECT_REQUESTS.md

Nenhum documento deve afirmar funcionalidade inexistente.

==================================================
25. REGRAS DE IMPLEMENTAÇÃO
=========================

Não apenas escreva plano.

Implemente.

Não remova testes para obter verde.

Não marque teste como skip sem blocker externo comprovado.

Não silencie TypeScript.

Não use catch vazio.

Não introduza any desnecessário.

Não desative security gate.

Não transforme fail-secure em fail-open.

Não introduza retry infinito.

Não armazenar token/secret em logs.

Não armazenar mídia insegura como pública.

Não confiar em autorização frontend.

Não declarar restore testado se não foi realmente restaurado.

Não declarar CI executado se workflow não rodou.

Não declarar TRIPLE_AAA_CERTIFIED sem evidência.

==================================================
26. ORDEM DE IMPLEMENTAÇÃO
=========================

Execute nesta ordem:

Phase Final-1
Persistent DLQ

Phase Final-2
OpenTelemetry

Phase Final-3
Object Storage

Phase Final-4
Malware / Quarantine

Phase Final-5
Restore E2E

Phase Final-6
Security CI Evidence

Phase Final-7
Vulnerability Triage

Phase Final-8
Realtime Multi-Replica

Phase Final-9
LGPD DSAR

Phase Final-10
AI Safety Completion

Phase Final-11
Performance

Phase Final-12
Chaos Completion

Final Certification

Não avance ignorando blocker crítico descoberto.

==================================================
27. COMMITS
===========

Use commits lógicos, por exemplo:

final-01/persistent-dlq
final-02/otel
final-03/media-storage
final-04/malware-quarantine
final-05/dr-e2e
final-06/security-ci
final-07/vulnerability-triage
final-08/realtime-scale
final-09/lgpd
final-10/ai-safety
final-11/performance
final-12/chaos
final-13/triple-aaa-certification

Não faça mega commit.

==================================================
28. FINAL SUCCESS BLOCK
=======================

(ver seção 28 do prompt original — bloco de certificação mecanicamente verificável)

==================================================
29. REGRA DE HONESTIDADE DE CERTIFICAÇÃO
========================================

Se qualquer blocker crítico permanecer:

não escreva:

TRIPLE_AAA_CERTIFIED

Use:

NOT_YET_CERTIFIED

e liste:

blocker
impact
evidence
recommended action

Certificação é um resultado técnico, não uma meta textual.

==================================================
30. RESULTADO ESPERADO
======================

A entrega ideal deve terminar com:

AAA-1 = VERIFIED
AAA-2 = VERIFIED
AAA-3 = VERIFIED

e:

FINAL STATUS:
TRIPLE_AAA_CERTIFIED

Mas somente se todos os gates forem comprovados.

O objetivo não é simplesmente aumentar a nota do projeto.

O objetivo é transformar o CVG Connect Desk em uma plataforma de atendimento digital realmente:

durável
segura
rastreável
recuperável
escalável
auditável
observável
testável
operável

capaz de funcionar como componente crítico da infraestrutura do Centro Veterinário Guarapiranga.

Comece agora pela revalidação do baseline e então execute a Final Triple AAA Certification Closure completa. . Me entregue um programa State of Art, Triplo AAA de qualidade.

---

**Metadados de arquivamento:**
- Origem: mensagem do usuário
- Arquivo: `docs/73-prompt-certificacao-final-triple-aaa.md`
- Certificação anterior: `docs/TRIPLE_AAA_CERTIFICATION.md` (NOT_YET_CERTIFIED, 6 blockers)
