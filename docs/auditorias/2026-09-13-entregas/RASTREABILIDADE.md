# Rastreabilidade dos55 itens históricos

Esta matriz preserva a origem de requisitos sem recalcular notas subjetivas. A evidência atual é a auditoria de entregas; a existência de uma tarefa não encerra o requisito.

| Item | Requisito | Tarefas de continuidade |
|---|---|---|
| BE01 | Arquitetura modular e composição Chat/Gateway (04,07,AAA-02) | PROD-00, PROD-01, PROD-10, PROD-28, PROD-39 |
| BE02 | Consistência da documentação canônica (04,05,ARCHITECTURE,ADRs) | PROD-01, PROD-39 |
| BE03 | Sessões opacas/hash/expiração/rotação (11,SECURITY,AAA-03) | PROD-01, PROD-05, PROD-06, PROD-17 |
| BE04 | RBAC + escopo por recurso (AUTHORIZATION,C02,AAA-04) | PROD-01, PROD-04, PROD-17, PROD-18, PROD-24, PROD-26, PROD-27 |
| BE05 | Autoria de notas (AAA-19) | PROD-16, PROD-18, PROD-21, PROD-22, PROD-26 |
| BE06 | Autorização realtime por destinatário/revogação (10,C02,AAA-05) | PROD-04, PROD-05, PROD-12, PROD-36, PROD-38 |
| BE07 | Lease/ACK fenced e consumers independentes (10,C03,AAA-07) | PROD-09, PROD-12 |
| BE08 | Transação inbound + outbox + hints pós-commit (09,10,AAA-08) | PROD-06, PROD-07, PROD-08 |
| BE09 | HMAC/anti-replay e recuperação webhook (06,11,SECURITY) | PROD-07, PROD-10 |
| BE10 | Idempotência outbound/escopo/hash/estado ambíguo (C04,AAA-12) | PROD-06, PROD-11, PROD-15, PROD-20, PROD-38 |
| BE11 | Efeitos worker idempotentes e recuperação (04,10,12) | PROD-09, PROD-10, PROD-18, PROD-23, PROD-31 |
| BE12 | DLQ persistente/claim/replay administrativo (ADR-001) | PROD-09, PROD-12, PROD-26 |
| BE13 | Secretary assíncrona e degradação (04,06,AI_SAFETY) | PROD-07, PROD-10, PROD-13 |
| BE14 | Policy/budgets IA e aprovação humana (AI_SAFETY) | PROD-13, PROD-31 |
| BE15 | Upload outbound/SSRF/magic/CLEAN (AAA-10,ADR-003/004) | PROD-11, PROD-14, PROD-15, PROD-20, PROD-38 |
| BE16 | Pipeline inbound scan/quarentena conectado (ADR-003/004) | PROD-14 |
| BE17 | Paginação conversas e latest SQL (AAA-11,C06) | PROD-04, PROD-08, PROD-19, PROD-30, PROD-33 |
| BE18 | Readiness/schema/dependências (AAA-09) | PROD-36 |
| BE19 | Logs/métricas/tracing/PII (12,AAA-18,ADR-002) | PROD-13, PROD-16, PROD-23, PROD-30, PROD-31, PROD-32 |
| BE20 | Privacidade/escopo/checkpoints/retencão (LGPD,C07,AAA-17) | PROD-01, PROD-04, PROD-06, PROD-16, PROD-31, PROD-37, PROD-38 |
| UI01 | Login e sessão da UI | PROD-05, PROD-17 |
| UI02 | Navegação e shell | PROD-04, PROD-17, PROD-24, PROD-29 |
| UI03 | Inbox — listagem, busca e histórico | PROD-19, PROD-20, PROD-29 |
| UI04 | Inbox — envio e recuperação | PROD-11, PROD-14, PROD-15, PROD-20 |
| UI05 | Inbox — operação/contexto hospitalar | PROD-01, PROD-18, PROD-19, PROD-25, PROD-27 |
| UI06 | Tarefas | PROD-18, PROD-21, PROD-30 |
| UI07 | Notas | PROD-22 |
| UI08 | Alertas | PROD-09, PROD-18, PROD-23, PROD-30 |
| UI09 | Dashboard operacional/premium | PROD-30, PROD-33 |
| UI10 | Kanban | PROD-01, PROD-18, PROD-27, PROD-30 |
| UI11 | Labels, setores e grupos | PROD-24 |
| UI12 | Contatos, tutores e pacientes | PROD-19, PROD-22, PROD-24, PROD-25, PROD-30 |
| UI13 | Administração, auditoria e perfil | PROD-01, PROD-04, PROD-17, PROD-26 |
| UI14 | Arquitetura e integração do frontend | PROD-28 |
| UI15 | Design system e estados | PROD-28, PROD-29, PROD-39 |
| UI16 | Responsividade e acessibilidade implementadas | PROD-20, PROD-29, PROD-33 |
| UI17 | Verificação frontend/E2E | PROD-34, PROD-38 |
| OP01 | Gate mestre rejeita evidência antiga/adulterada (AAA-26) | PROD-02 |
| OP02 | Agregador cross-workflow por SHA (AAA-26) | PROD-03 |
| OP03 | CI macro e regressões de segurança (AAA-16/26, docs 56/57) | PROD-03, PROD-34 |
| OP04 | Supply chain/dependências (AAA-15) | PROD-35 |
| OP05 | Smoke browser reproduzível (docs 39/42/45–49) | PROD-03, PROD-38 |
| OP06 | Isolamento de testes (AAA-00) | PROD-00, PROD-37 |
| OP07 | Cobertura/qualidade de testes (docs25, TEST_MATRIX) | PROD-02, PROD-34 |
| OP08 | Backup/restore representativo (AAA-24, DR) | PROD-16, PROD-37 |
| OP09 | Deploy/containers (PRODUCTION_DEPLOYMENT) | PROD-32, PROD-35, PROD-36 |
| OP10 | Verificador production-readiness | PROD-36 |
| OP11 | Health / operabilidade do worker | PROD-36 |
| OP12 | Logs/métricas operacionais (docs66–70/OBSERVABILITY) | PROD-31, PROD-33 |
| OP13 | Tracing real (AAA-25/OBSERVABILITY) | PROD-32 |
| OP14 | Staging MinIO/ClamAV | PROD-32 |
| OP15 | SLO/carga/dashboards/alertas (AAA-25) | PROD-33 |
| OP16 | Reconciliação documental e certificação final (AAA-27/28) | PROD-01, PROD-02, PROD-03, PROD-39 |
| DT01 | Modelo de dados, integridade e migrações (docs05/09, C01/C03/C06) | PROD-01, PROD-06, PROD-08, PROD-25, PROD-37, PROD-39 |
| DT02 | Qualidade TypeScript/lint dos pacotes (AAA-16/C08) | PROD-00, PROD-28, PROD-34, PROD-35 |
