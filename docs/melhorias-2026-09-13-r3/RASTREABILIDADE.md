# Rastreabilidade da auditoria

Os 55 itens têm tarefas executoras antes de PROD-40. A revisão final de todos os itens é adicional e não conta como implementação. Notas abaixo são históricas, não progresso do backlog.

| Item | Descrição auditada | Nota histórica | Tarefas executoras |
|---|---|---|---|
| BE01 | Arquitetura modular e composição Chat/Gateway (04,07,AAA-02) | 84 | [PROD-00](tasks/PROD-00.md), [PROD-01](tasks/PROD-01.md), [PROD-10](tasks/PROD-10.md), [PROD-28](tasks/PROD-28.md), [PROD-39](tasks/PROD-39.md) |
| BE02 | Consistência da documentação canônica (04,05,ARCHITECTURE,ADRs) | 48 | [PROD-01](tasks/PROD-01.md), [PROD-39](tasks/PROD-39.md) |
| BE03 | Sessões opacas/hash/expiração/rotação (11,SECURITY,AAA-03) | 86 | [PROD-01](tasks/PROD-01.md), [PROD-05](tasks/PROD-05.md), [PROD-06](tasks/PROD-06.md), [PROD-17](tasks/PROD-17.md) |
| BE04 | RBAC + escopo por recurso (AUTHORIZATION,C02,AAA-04) | 60 | [PROD-01](tasks/PROD-01.md), [PROD-04](tasks/PROD-04.md), [PROD-17](tasks/PROD-17.md), [PROD-18](tasks/PROD-18.md), [PROD-24](tasks/PROD-24.md), [PROD-26](tasks/PROD-26.md), [PROD-27](tasks/PROD-27.md) |
| BE05 | Autoria de notas (AAA-19) | 87 | [PROD-16](tasks/PROD-16.md), [PROD-18](tasks/PROD-18.md), [PROD-21](tasks/PROD-21.md), [PROD-22](tasks/PROD-22.md), [PROD-26](tasks/PROD-26.md) |
| BE06 | Autorização realtime por destinatário/revogação (10,C02,AAA-05) | 84 | [PROD-04](tasks/PROD-04.md), [PROD-05](tasks/PROD-05.md), [PROD-12](tasks/PROD-12.md), [PROD-36](tasks/PROD-36.md), [PROD-38](tasks/PROD-38.md) |
| BE07 | Lease/ACK fenced e consumers independentes (10,C03,AAA-07) | 84 | [PROD-09](tasks/PROD-09.md), [PROD-12](tasks/PROD-12.md) |
| BE08 | Transação inbound + outbox + hints pós-commit (09,10,AAA-08) | 76 | [PROD-06](tasks/PROD-06.md), [PROD-07](tasks/PROD-07.md), [PROD-08](tasks/PROD-08.md) |
| BE09 | HMAC/anti-replay e recuperação webhook (06,11,SECURITY) | 70 | [PROD-07](tasks/PROD-07.md), [PROD-10](tasks/PROD-10.md) |
| BE10 | Idempotência outbound/escopo/hash/estado ambíguo (C04,AAA-12) | 85 | [PROD-06](tasks/PROD-06.md), [PROD-11](tasks/PROD-11.md), [PROD-15](tasks/PROD-15.md), [PROD-20](tasks/PROD-20.md), [PROD-38](tasks/PROD-38.md) |
| BE11 | Efeitos worker idempotentes e recuperação (04,10,12) | 43 | [PROD-09](tasks/PROD-09.md), [PROD-10](tasks/PROD-10.md), [PROD-18](tasks/PROD-18.md), [PROD-23](tasks/PROD-23.md), [PROD-31](tasks/PROD-31.md) |
| BE12 | DLQ persistente/claim/replay administrativo (ADR-001) | 78 | [PROD-09](tasks/PROD-09.md), [PROD-12](tasks/PROD-12.md), [PROD-26](tasks/PROD-26.md) |
| BE13 | Secretary assíncrona e degradação (04,06,AI_SAFETY) | 58 | [PROD-07](tasks/PROD-07.md), [PROD-10](tasks/PROD-10.md), [PROD-13](tasks/PROD-13.md) |
| BE14 | Policy/budgets IA e aprovação humana (AI_SAFETY) | 45 | [PROD-13](tasks/PROD-13.md), [PROD-31](tasks/PROD-31.md) |
| BE15 | Upload outbound/SSRF/magic/CLEAN (AAA-10,ADR-003/004) | 82 | [PROD-11](tasks/PROD-11.md), [PROD-14](tasks/PROD-14.md), [PROD-15](tasks/PROD-15.md), [PROD-20](tasks/PROD-20.md), [PROD-38](tasks/PROD-38.md) |
| BE16 | Pipeline inbound scan/quarentena conectado (ADR-003/004) | 40 | [PROD-14](tasks/PROD-14.md) |
| BE17 | Paginação conversas e latest SQL (AAA-11,C06) | 78 | [PROD-04](tasks/PROD-04.md), [PROD-08](tasks/PROD-08.md), [PROD-19](tasks/PROD-19.md), [PROD-30](tasks/PROD-30.md), [PROD-33](tasks/PROD-33.md) |
| BE18 | Readiness/schema/dependências (AAA-09) | 84 | [PROD-36](tasks/PROD-36.md) |
| BE19 | Logs/métricas/tracing/PII (12,AAA-18,ADR-002) | 74 | [PROD-13](tasks/PROD-13.md), [PROD-16](tasks/PROD-16.md), [PROD-23](tasks/PROD-23.md), [PROD-30](tasks/PROD-30.md), [PROD-31](tasks/PROD-31.md), [PROD-32](tasks/PROD-32.md) |
| BE20 | Privacidade/escopo/checkpoints/retencão (LGPD,C07,AAA-17) | 69 | [PROD-01](tasks/PROD-01.md), [PROD-04](tasks/PROD-04.md), [PROD-06](tasks/PROD-06.md), [PROD-16](tasks/PROD-16.md), [PROD-31](tasks/PROD-31.md), [PROD-37](tasks/PROD-37.md), [PROD-38](tasks/PROD-38.md) |
| UI01 | Login e sessão da UI | 88 | [PROD-05](tasks/PROD-05.md), [PROD-17](tasks/PROD-17.md) |
| UI02 | Navegação e shell | 83 | [PROD-04](tasks/PROD-04.md), [PROD-17](tasks/PROD-17.md), [PROD-24](tasks/PROD-24.md), [PROD-29](tasks/PROD-29.md) |
| UI03 | Inbox — listagem, busca e histórico | 68 | [PROD-19](tasks/PROD-19.md), [PROD-20](tasks/PROD-20.md), [PROD-29](tasks/PROD-29.md) |
| UI04 | Inbox — envio e recuperação | 82 | [PROD-11](tasks/PROD-11.md), [PROD-14](tasks/PROD-14.md), [PROD-15](tasks/PROD-15.md), [PROD-20](tasks/PROD-20.md) |
| UI05 | Inbox — operação/contexto hospitalar | 25 | [PROD-01](tasks/PROD-01.md), [PROD-18](tasks/PROD-18.md), [PROD-19](tasks/PROD-19.md), [PROD-25](tasks/PROD-25.md), [PROD-27](tasks/PROD-27.md) |
| UI06 | Tarefas | 60 | [PROD-18](tasks/PROD-18.md), [PROD-21](tasks/PROD-21.md), [PROD-30](tasks/PROD-30.md) |
| UI07 | Notas | 72 | [PROD-22](tasks/PROD-22.md) |
| UI08 | Alertas | 72 | [PROD-09](tasks/PROD-09.md), [PROD-18](tasks/PROD-18.md), [PROD-23](tasks/PROD-23.md), [PROD-30](tasks/PROD-30.md) |
| UI09 | Dashboard operacional/premium | 85 | [PROD-30](tasks/PROD-30.md), [PROD-33](tasks/PROD-33.md) |
| UI10 | Kanban | 62 | [PROD-01](tasks/PROD-01.md), [PROD-18](tasks/PROD-18.md), [PROD-27](tasks/PROD-27.md), [PROD-30](tasks/PROD-30.md) |
| UI11 | Labels, setores e grupos | 62 | [PROD-24](tasks/PROD-24.md) |
| UI12 | Contatos, tutores e pacientes | 80 | [PROD-19](tasks/PROD-19.md), [PROD-22](tasks/PROD-22.md), [PROD-24](tasks/PROD-24.md), [PROD-25](tasks/PROD-25.md), [PROD-30](tasks/PROD-30.md) |
| UI13 | Administração, auditoria e perfil | 76 | [PROD-01](tasks/PROD-01.md), [PROD-04](tasks/PROD-04.md), [PROD-17](tasks/PROD-17.md), [PROD-26](tasks/PROD-26.md) |
| UI14 | Arquitetura e integração do frontend | 64 | [PROD-28](tasks/PROD-28.md) |
| UI15 | Design system e estados | 82 | [PROD-28](tasks/PROD-28.md), [PROD-29](tasks/PROD-29.md), [PROD-39](tasks/PROD-39.md) |
| UI16 | Responsividade e acessibilidade implementadas | 65 | [PROD-20](tasks/PROD-20.md), [PROD-29](tasks/PROD-29.md), [PROD-33](tasks/PROD-33.md) |
| UI17 | Verificação frontend/E2E | 68 | [PROD-34](tasks/PROD-34.md), [PROD-38](tasks/PROD-38.md) |
| OP01 | Gate mestre rejeita evidência antiga/adulterada (AAA-26) | 25 | [PROD-02](tasks/PROD-02.md) |
| OP02 | Agregador cross-workflow por SHA (AAA-26) | 50 | [PROD-03](tasks/PROD-03.md) |
| OP03 | CI macro e regressões de segurança (AAA-16/26, docs 56/57) | 65 | [PROD-03](tasks/PROD-03.md), [PROD-34](tasks/PROD-34.md) |
| OP04 | Supply chain/dependências (AAA-15) | 80 | [PROD-35](tasks/PROD-35.md) |
| OP05 | Smoke browser reproduzível (docs 39/42/45–49) | 65 | [PROD-03](tasks/PROD-03.md), [PROD-38](tasks/PROD-38.md) |
| OP06 | Isolamento de testes (AAA-00) | 75 | [PROD-00](tasks/PROD-00.md), [PROD-37](tasks/PROD-37.md) |
| OP07 | Cobertura/qualidade de testes (docs25, TEST_MATRIX) | 55 | [PROD-02](tasks/PROD-02.md), [PROD-34](tasks/PROD-34.md) |
| OP08 | Backup/restore representativo (AAA-24, DR) | 45 | [PROD-16](tasks/PROD-16.md), [PROD-37](tasks/PROD-37.md) |
| OP09 | Deploy/containers (PRODUCTION_DEPLOYMENT) | 70 | [PROD-32](tasks/PROD-32.md), [PROD-35](tasks/PROD-35.md), [PROD-36](tasks/PROD-36.md) |
| OP10 | Verificador production-readiness | 40 | [PROD-36](tasks/PROD-36.md) |
| OP11 | Health / operabilidade do worker | 65 | [PROD-36](tasks/PROD-36.md) |
| OP12 | Logs/métricas operacionais (docs66–70/OBSERVABILITY) | 75 | [PROD-31](tasks/PROD-31.md), [PROD-33](tasks/PROD-33.md) |
| OP13 | Tracing real (AAA-25/OBSERVABILITY) | 50 | [PROD-32](tasks/PROD-32.md) |
| OP14 | Staging MinIO/ClamAV | 45 | [PROD-32](tasks/PROD-32.md) |
| OP15 | SLO/carga/dashboards/alertas (AAA-25) | 25 | [PROD-33](tasks/PROD-33.md) |
| OP16 | Reconciliação documental e certificação final (AAA-27/28) | 35 | [PROD-01](tasks/PROD-01.md), [PROD-02](tasks/PROD-02.md), [PROD-03](tasks/PROD-03.md), [PROD-39](tasks/PROD-39.md) |
| DT01 | Modelo de dados, integridade e migrações (docs05/09, C01/C03/C06) | 74 | [PROD-01](tasks/PROD-01.md), [PROD-06](tasks/PROD-06.md), [PROD-08](tasks/PROD-08.md), [PROD-25](tasks/PROD-25.md), [PROD-37](tasks/PROD-37.md), [PROD-39](tasks/PROD-39.md) |
| DT02 | Qualidade TypeScript/lint dos pacotes (AAA-16/C08) | 88 | [PROD-00](tasks/PROD-00.md), [PROD-28](tasks/PROD-28.md), [PROD-34](tasks/PROD-34.md), [PROD-35](tasks/PROD-35.md) |

## Achados históricos reavaliados e novos (RESOLVED exige apenas preservar regressões)

| Achado | Tarefas responsáveis |
|---|---|
| BE-A01 [PARTIAL] — Secretary reabre estado unknown e refaz chamada externa | [PROD-10](tasks/PROD-10.md), [PROD-12](tasks/PROD-12.md), [PROD-13](tasks/PROD-13.md) |
| BE-A02 [RESOLVED] — Retry de webhook com timestamp renovado é rejeitado como payload diferente | [PROD-07](tasks/PROD-07.md) |
| BE-A03 [RESOLVED] — Duplicata já commitada ainda recebe 409 contra o contrato C03 | [PROD-01](tasks/PROD-01.md), [PROD-07](tasks/PROD-07.md) |
| BE-A04 [PARTIAL] — Recuperação de mídia não é acionada pelo runtime e exclui SCAN_FAILED | [PROD-14](tasks/PROD-14.md) |
| BE-A05 [OPEN] — Endpoint legado de anonimização contorna política e escopo de mutação | [PROD-04](tasks/PROD-04.md), [PROD-16](tasks/PROD-16.md) |
| BE-A06 [OPEN] — CAS é opcional e cliente atual não envia versão | [PROD-18](tasks/PROD-18.md), [PROD-19](tasks/PROD-19.md), [PROD-27](tasks/PROD-27.md) |
| OPS01 [RESOLVED] — Digest esperado é ignorado na reavaliação | [PROD-02](tasks/PROD-02.md), [PROD-35](tasks/PROD-35.md) |
| OPS02 [RESOLVED] — Manifesto contraditório com log vazio recebe PASS | [PROD-02](tasks/PROD-02.md), [PROD-34](tasks/PROD-34.md) |
| OPS03 [PARTIAL] — Query-performance sem medição recebe PASS | [PROD-02](tasks/PROD-02.md), [PROD-33](tasks/PROD-33.md) |
| OPS04 [RESOLVED] — Evento desconhecido cai silenciosamente em push | [PROD-03](tasks/PROD-03.md) |
| OPS05 [OPEN] — Smoke real MinIO não consegue provar delete | [PROD-32](tasks/PROD-32.md) |
| OPS06 [PARTIAL] — Prova de imagem identifica build local, sem ligação com boot/scan/entrega | [PROD-03](tasks/PROD-03.md), [PROD-35](tasks/PROD-35.md), [PROD-38](tasks/PROD-38.md) |
| OPS07 [PARTIAL] — Conjunto entregue não sela candidato atual | [PROD-00](tasks/PROD-00.md), [PROD-36](tasks/PROD-36.md), [PROD-40](tasks/PROD-40.md) |
| OPS08 [OPEN] — DR usa bancos fixos destrutivos e prova de fixture insuficiente | [PROD-37](tasks/PROD-37.md) |
| DOC01 [PARTIAL] — Documentação e metadados de execução contradizem as entregas | [PROD-00](tasks/PROD-00.md), [PROD-01](tasks/PROD-01.md), [PROD-39](tasks/PROD-39.md) |
| FE01 [OPEN] — Drawer fechado amplia Inbox 1024 para 1318 pixels e continua no DOM acessível | [PROD-29](tasks/PROD-29.md) |
| FE02 [OPEN] — Operação no contexto incompleta: transferência desabilitada; cadastro abre lista genérica | [PROD-19](tasks/PROD-19.md) |
| FE03 [OPEN] — Busca e contagens consideram apenas conversas carregadas; parâmetros de consulta não incluem busca/status/responsável/labels | [PROD-19](tasks/PROD-19.md) |
| FE04 [OPEN] — Timeline rotula qualquer histórico como Hoje | [PROD-20](tasks/PROD-20.md) |
| FE05 [OPEN] — asset:// é chip sem ação; documento/vídeo não têm componente de leitura completo | [PROD-20](tasks/PROD-20.md) |
| FE06 [OPEN] — Rascunhos e intenções existem só em memória do Inbox; sair/remontar perde estado | [PROD-20](tasks/PROD-20.md) |
| FE07 [OPEN] — Tarefa não permite atribuição/vínculos no formulário nem abrir conversa do card | [PROD-21](tasks/PROD-21.md) |
| FE08 [OPEN] — Nota exige ID técnico e apresenta referência truncada sem navegação | [PROD-22](tasks/PROD-22.md) |
| FE09 [OPEN] — Ficha de contato carrega/cria notas apenas na primeira conversa | [PROD-22](tasks/PROD-22.md), [PROD-25](tasks/PROD-25.md) |
| FE10 [OPEN] — Alertas têm ack/resolve mas não navegam ao recurso relacionado | [PROD-23](tasks/PROD-23.md) |
| FE11 [OPEN] — Grupos só exibem membros; instrução para adicionar pela ficha não corresponde a controle ali | [PROD-24](tasks/PROD-24.md) |
| FE12 [OPEN] — Paciente ainda usa tutorId singular; N:N não representado pela UI | [PROD-25](tasks/PROD-25.md) |
| FE13 [OPEN] — Admin não possui editor de permissões por papel/vínculo usuário-papel nem gestão completa de membros de times/filas | [PROD-26](tasks/PROD-26.md) |
| FE14 [OPEN] — Kanban move por select/drag, mas card não abre conversa e só há filtro de setor | [PROD-27](tasks/PROD-27.md) |
| FE15 [OPEN] — Tasks/Alerts/Contacts/Kanban/Dashboard não assinam realtime nem executam polling bounded | [PROD-30](tasks/PROD-30.md) |
| FE16 [OPEN] — Monólitos de página e duplicação de estados continuam; features/inbox ausente | [PROD-28](tasks/PROD-28.md) |
| FE17 [OPEN] — Percurso E2E produção completo não está implementado na pasta de suites | [PROD-38](tasks/PROD-38.md) |
| R3-BE01 [OPEN] — Crash após admissão Secretary deixa processing órfão e redelivery reconhecida como concluída | [PROD-10](tasks/PROD-10.md), [PROD-12](tasks/PROD-12.md), [PROD-13](tasks/PROD-13.md) |
| R3-BE02 [OPEN] — Recovery de mídia pode esgotar pool com locks que aguardam outra conexão do mesmo pool | [PROD-14](tasks/PROD-14.md), [PROD-32](tasks/PROD-32.md) |
| R3-OP01 [OPEN] — Query gate aceita medições nulas ou acima do orçamento e datas futuras | [PROD-02](tasks/PROD-02.md), [PROD-33](tasks/PROD-33.md) |
| R3-OP02 [OPEN] — Artefato derivado dispensa runId/attempt exigidos pelo contrato de evidência | [PROD-02](tasks/PROD-02.md), [PROD-03](tasks/PROD-03.md), [PROD-40](tasks/PROD-40.md) |
| R3-RT01 [OPEN] — Importação de metrics impede bootstrap nativo do realtime | [PROD-05](tasks/PROD-05.md), [PROD-34](tasks/PROD-34.md), [PROD-36](tasks/PROD-36.md), [PROD-44](tasks/PROD-44.md) |
