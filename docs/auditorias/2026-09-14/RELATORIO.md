# Auditoria completa — CVG Connect Desk

**Data:** 14/09/2026 · **Nota geral: 73/100** · **Produto: NOT_READY para produção.**

Há um produto substancialmente construído: quatro runtimes, módulos operacionais reais, banco com migrações, autenticação/autorização, eventos persistentes e interface navegável. Os testes atuais mostram uma base funcional. As principais lacunas estão em caminhos antigos que contornam o núcleo transacional, continuidade do contexto entre telas e comprovação/configuração de operação.

Esta é uma auditoria e um relatório, não uma implementação de melhorias nem uma autorização de implantação. Nenhum defeito de produto foi corrigido nesta rodada. Foram gerados relatório/evidências e artefatos de build/teste; não houve edição intencional de fontes de produto, commit ou deploy.

## 1. Escopo, método e critério das notas

- Candidato: HEAD `754f9badac46278e77d21de91c58eedb15e80581` **mais worktree**, inicialmente com 492 entradas no `git status`. O commit sozinho não identifica o produto auditado.
- Ambiente: Node 24.20.0, pnpm 10.33.0; PostgreSQL 15 e Redis 7 descartáveis, criados exclusivamente para esta auditoria.
- Foram inventariados **550 Markdown em docs**, sendo **102 na raiz**, excluindo cópias `before-snapshot`. O [inventário](evidencias/docs-inventory.json) contém caminhos, títulos, tamanhos e hashes. Inventário não significa leitura crítica integral de cada log/relatório gerado: a leitura semântica concentrou-se nas especificações, contratos, ADRs, design e referências de estado, com consulta seletiva dos históricos.
- Inspeção: documentação → rotas/UI → casos de uso/repositórios → banco/eventos → testes/configuração. A profundidade variou por risco; operações amostrais estão identificadas.
- Escopo de código inventariado: 474 arquivos TS/TSX sem declarações geradas em apps/packages/modules, aproximadamente 94.209 linhas, **incluindo testes**. Não equivale a tamanho do código de produção.
- Auditoria com quatro faixas: integração/documentação pelo lead; backend/dados; interface/design; operação. Crítico final novo, sem histórico, revisa fontes/evidências. Independência I1: contexto separado, mesma família de modelo, filesystem compartilhado; não é avaliação externa humana.

### Barra de aceitação da auditoria

B1: requisitos documentais rastreáveis à implementação. B2: achados com fonte e limites. B3: checks atuais separados de cache/histórico. B4: render e mocks identificados. B5: notas não substituem gates de produção. B6: preservação das fontes monitoradas. O escopo é diagnóstico; correção e ciclos de implementação da Gauntlet não foram autorizados por este pedido.

### Como interpretar 0–100

Notas são **avaliações heurísticas de maturidade demonstrada**, orientadas por aderência funcional, robustez, evidência e manutenção. Não são percentual de funcionalidades concluídas, probabilidade de ausência de bugs, cobertura de testes ou certificação. Uma área não executada não recebe zero automaticamente: a limitação reduz a confiança e a nota de comprovação operacional, sem afirmar defeito inexistente.

- 90–100: muito sólido no recorte observado; aprovação depende dos gates.
- 80–89: boa implementação com limites relevantes.
- 70–79: funcional, exige revisão.
- 60–69: entrega parcial ou risco relevante.
- 40–59: lacunas importantes.
- 0–39: comprovação/entrega insuficiente no critério avaliado.

A nota geral usa média por bloco e pesos explícitos, para que a quantidade de telas não dilua risco operacional. Notas visuais e de backend do mesmo módulo medem perspectivas diferentes. Não contar ambas como duas funcionalidades entregues.

| Bloco | Média /100 | Peso |
|---|---:|---:|
| Backend/dados/integrações | 81.17 | 40% |
| Interface | 81.81 | 25% |
| Operação e comprovação | 54.57 | 25% |
| Qualidade de código e documentação | 67.00 | 10% |

Resultado calculado: **73.27/100**, arredondado para **73/100**. A média não elimina os achados altos abaixo.

## 2. Backend, dados e integrações — 23 itens

| Item | Nota | O que existe / o que limita | Evidência | Confiança |
|---|---:|---|---|---|
| Arquitetura e API | 79 | API registra os módulos efetivos; controllers antigos ainda concentram regras e persistência. | [apps/desk-api/src/app.ts](/home/ricardo/cvg-connect-desk/apps/desk-api/src/app.ts:656) | Alta |
| Autenticação e sessões | 89 | Sessões opacas, hash, expiração/inatividade, rotação e validação de login. Não exigir JWT como sinônimo de segurança. | [packages/auth/src/session-policy.ts](/home/ricardo/cvg-connect-desk/packages/auth/src/session-policy.ts) | Alta |
| RBAC e autorização por recurso | 84 | Permissões do banco, ação + recurso/setor e negação por ausência de vínculo; agregados globais precisam de regra explícita. | [packages/auth/src/resource-authz.ts](/home/ricardo/cvg-connect-desk/packages/auth/src/resource-authz.ts:119) | Alta |
| Administração/IAM | 57 | CRUD de usuários, papéis, filas/times; hash exposto nas respostas e alterações parcialmente transacionais. | [modules/admin/src/presentation/http/admin.controller.ts](/home/ricardo/cvg-connect-desk/modules/admin/src/presentation/http/admin.controller.ts:64) | Alta |
| Chat inbound/outbound | 89 | Núcleo transacional com idempotência, locks, outbox e reconciliação; caminhos alternativos não têm as mesmas garantias. | [modules/chat/src/infrastructure/repositories/inbound-atomic.repository.ts](/home/ricardo/cvg-connect-desk/modules/chat/src/infrastructure/repositories/inbound-atomic.repository.ts:131) | Alta |
| Contatos | 69 | CRUD/busca/detalhe e início de conversa; startConversation separa conversa e histórico sem transação/evento. | [modules/contacts/src/application/use-cases/index.ts](/home/ricardo/cvg-connect-desk/modules/contacts/src/application/use-cases/index.ts:43) | Alta |
| Kanban — comportamento backend | 59 | Board e movimento com autorização; reabertura mantém conversa inativa e movimento faz escritas independentes. | [modules/kanban/src/presentation/http/kanban.controller.ts](/home/ricardo/cvg-connect-desk/modules/kanban/src/presentation/http/kanban.controller.ts:220) | Alta |
| Tarefas — domínio | 87 | Criação e transições com vínculo, histórico, controle concorrente, auditoria e outbox. | [modules/tasks/src/application/use-cases/update-task-status.use-case.ts](/home/ricardo/cvg-connect-desk/modules/tasks/src/application/use-cases/update-task-status.use-case.ts:37) | Média-alta |
| Notas — domínio | 86 | Autoria vem da sessão; referências e persistência com auditoria/outbox transacionais. | [modules/notes/src/application/use-cases/create-note.use-case.ts](/home/ricardo/cvg-connect-desk/modules/notes/src/application/use-cases/create-note.use-case.ts:44) | Média-alta |
| Alertas — domínio | 85 | Lifecycle de criação/reconhecimento/resolução; histórico anterior pode ficar desatualizado numa corrida ack/resolve. | [modules/alerts/src/application/use-cases/resolve-alert.use-case.ts](/home/ricardo/cvg-connect-desk/modules/alerts/src/application/use-cases/resolve-alert.use-case.ts:68) | Média-alta |
| Transferências | 88 | Criação, aceite e rejeição com transações, trilha e controle de concorrência. | [modules/transfers/src/application/use-cases/index.ts](/home/ricardo/cvg-connect-desk/modules/transfers/src/application/use-cases/index.ts:87) | Média-alta |
| Setores, etiquetas e grupos — domínio | 77 | Rotas, casos de uso e repositórios reais; inspeção amostral de operações, sem validar toda combinação de membership. | [modules/contact-groups/src/application/use-cases/index.ts](/home/ricardo/cvg-connect-desk/modules/contact-groups/src/application/use-cases/index.ts) | Média |
| Tutores e pacientes — domínio | 80 | CRUD com validação e RBAC; paciente conserva tutorId singular, enquanto o alvo documental prevê N:N. | [packages/database/src/schema.ts](/home/ricardo/cvg-connect-desk/packages/database/src/schema.ts:41) | Média |
| Dashboard/KPIs — domínio | 76 | Consultas reais de fluxo/aging/handoff; validação de datas e agrupamento irregular; escopo global exige decisão. | [modules/dashboard/src/presentation/http/dashboard.controller.ts](/home/ricardo/cvg-connect-desk/modules/dashboard/src/presentation/http/dashboard.controller.ts:90) | Alta |
| Auditoria de negócio | 76 | Persistência e trilha no núcleo recente; ausente ou posterior ao commit em caminhos antigos de admin/contatos/Kanban. | [modules/audit/src/application/use-cases/index.ts](/home/ricardo/cvg-connect-desk/modules/audit/src/application/use-cases/index.ts:3) | Alta |
| Banco, integridade e migrações | 86 | Schema amplo, FKs/índices e migração fresca executada; upgrade e todos invariantes não foram exercitados nesta rodada. | [packages/database/src/schema.ts](/home/ricardo/cvg-connect-desk/packages/database/src/schema.ts:478) | Média-alta |
| Eventos, outbox e DLQ | 90 | Claims por consumidor, lease/fencing, retry e DLQ persistente; suíte com PG/Redis passou, sem prova integral de crash físico. | [packages/events/src/outbox-lease.ts](/home/ricardo/cvg-connect-desk/packages/events/src/outbox-lease.ts:5) | Média-alta |
| Worker | 88 | Contrato de eventos, efeito antes de ACK, classificação de falhas, retry e DLQ; não é prova de operação prolongada. | [apps/message-worker/src/processor.ts](/home/ricardo/cvg-connect-desk/apps/message-worker/src/processor.ts:75) | Alta |
| Realtime — implementação | 88 | Auth por mensagem, autorização por entrega, revalidação e fanout; boot nativo passou. Falha de configuração Compose é pontuada em operação. | [apps/realtime-service/src/authorization.ts](/home/ricardo/cvg-connect-desk/apps/realtime-service/src/authorization.ts:75) | Alta |
| Gateway e compatibilidade de canal | 86 | Adapter com timeout, aceite ambíguo e retry condicionado à idempotência; integração com provedor real não foi executada. | [modules/gateway-adapter/src/infrastructure/gateway-service.ts](/home/ricardo/cvg-connect-desk/modules/gateway-adapter/src/infrastructure/gateway-service.ts:60) | Média-alta |
| Secretary e controles de IA | 84 | Invocação persistida, handoff, policy/budget e aprovação; ferramentas/provedor real e política operacional ainda não certificados. | [modules/secretary-adapter/src/application/use-cases/invoke-secretary.use-case.ts](/home/ricardo/cvg-connect-desk/modules/secretary-adapter/src/application/use-cases/invoke-secretary.use-case.ts:54) | Média |
| Privacidade e solicitações de titulares | 83 | Exportação por escopo e operação retomável; rota legada já checa escopo. Políticas, resíduos/backup e eliminação real exigem validação própria. | [modules/privacy/src/application/erasure-operation.ts](/home/ricardo/cvg-connect-desk/modules/privacy/src/application/erasure-operation.ts:350) | Média |
| Mídia privada e quarentena | 81 | Storage/scanner, CLEAN/INFECTED e retomada implementados; 26 testes passaram e 21 específicos foram ignorados. MinIO/ClamAV reais não validados aqui. | [packages/media/src/index.ts](/home/ricardo/cvg-connect-desk/packages/media/src/index.ts:125) | Média |

## 3. Interface — 16 superfícies

Notas da experiência visual e de interação observada, com **confiança média**: render atual e testes, mas API simulada e estados amostrais.

| Superfície | Nota | Avaliação |
|---|---:|---|
| Login | 88 | Identidade, legibilidade e ação principal claras. |
| Inbox | 80 | Master/detail e ações implementados; atalhos perdem contexto e painel não mostra pendências inline. |
| Dashboard | 84 | Métricas e estados parciais explícitos; percurso móvel longo. |
| Tarefas | 78 | Ações/erros claros; contexto descartado e conteúdo útil abaixo de muitos resumos. |
| Alertas | 77 | Severidade e ações identificadas; alerta crítico deslocado no celular. |
| Notas | 72 | Estados claros; exige ID manual e descarta contexto da conversa. |
| Kanban — superfície | 84 | Rolagem contida e alternativa de movimento por teclado/toque; nota não valida persistência do movimento. |
| Contatos | 85 | Lista/detalhe móvel e início de atendimento visíveis. |
| Tutores | 84 | Cadastro e vínculos apresentados de forma consistente. |
| Pacientes | 84 | Vínculo com tutor claro; modelo N:N continua pendência do domínio. |
| Setores | 84 | Composição, ações e status coerentes. |
| Etiquetas/Labels | 82 | Estado vazio útil; vocabulário inconsistente. |
| Grupos de contatos | 83 | Lista/detalhe móvel funcional; apresentação de telefone pouco refinada. |
| Admin — superfície | 83 | Tabela orienta rolagem e diálogos passaram teclado; não neutraliza exposição de dados na API. |
| Audit — superfície | 79 | Busca exige códigos técnicos; estados vazios claros. |
| Configurações/perfil | 82 | Perfil e segurança legíveis; excesso de detalhes internos. |

Evidências: [matriz de render](evidencias/visual-render.json), [axe](evidencias/visual-axe.json), [reprodução de contexto](evidencias/visual-context.json), [checks adicionais](evidencias/visual-extra.json) e [capturas](evidencias/screenshots). Os caminhos `/tmp` registrados no harness descrevem a execução original; cópias duráveis estão neste pacote.

### Aspectos transversais de UX

| Aspecto | Nota /100 | Interpretação |
|---|---:|---|
| Cobertura de áreas/rotas | 92 | As 16 rotas canônicas foram renderizadas. |
| Arquitetura frontend | 75 | Páginas extensas misturam orquestração e apresentação. |
| Navegação e shell | 86 | Menu móvel, foco e modais funcionam no recorte testado. |
| Continuidade contextual | 68 | Atalhos de conversa descartam contexto. |
| Hierarquia/densidade | 78 | Resumos e filtros atrasam acesso ao trabalho no celular. |
| Identidade/cores/consistência | 86 | Linguagem CVG coerente, com alguns resíduos visuais. |
| Tipografia | 78 | Tokens nomeiam fontes que não estão carregadas; usa fallback. |
| Responsividade observada | 84 | Sem overflow global na matriz; sombra residual da sidebar. |
| Acessibilidade observada | 87 | Resultados automáticos favoráveis, leitor de tela/zoom real não verificados. |
| Estados e recuperação | 88 | Loading/erro/retry possuem implementação e testes atuais. |
| Conexões UI/API inspecionadas | 76 | Contratos visíveis; fluxo externo completo não executado. |

Esses aspectos explicam a avaliação visual, **não entram novamente na média geral**. Não há certificação WCAG nem elegibilidade AAA demonstrada.

Exemplos: [Inbox desktop com conversa](evidencias/screenshots/inbox-selected-1440.png), [Tarefas em 375px](evidencias/screenshots/tasks-mobile-375.png), [Alertas em 375px](evidencias/screenshots/alerts-mobile-375.png).

## 4. Operação, segurança operacional e verificabilidade — 7 itens

Confiança alta sobre configurações/predicados inspecionados e média sobre comportamento operacional ainda não executado.

| Item | Nota | Avaliação | Evidência |
|---|---:|---|---|
| CI e gates de qualidade | 72 | Checkout por SHA, lockfile e agregação implementados; 51 testes do agregador passaram. Falta evidência integral de release. | [.github/scripts/certification-aggregator.mjs](/home/ricardo/cvg-connect-desk/.github/scripts/certification-aggregator.mjs:36) |
| Docker e implantação | 50 | Hardening de containers existe, mas realtime não recebe DATABASE_URL no Compose de produção. | [docker-compose.yml](/home/ricardo/cvg-connect-desk/docker-compose.yml:232) |
| Segurança operacional e cadeia de fornecimento | 62 | Scans/SBOM declarados; scan de container cobre apenas API e não comprova identidade de todas imagens entregues. | [.github/workflows/security.yml](/home/ricardo/cvg-connect-desk/.github/workflows/security.yml:49) |
| Observabilidade | 49 | Métricas autenticadas e tracing existem; não há conjunto provisionável completo de dashboards/regras de alerta. | [infra/prometheus/prometheus.yml](/home/ricardo/cvg-connect-desk/infra/prometheus/prometheus.yml:1) |
| Testes e cobertura contratual | 71 | 1209 testes passaram com banco isolado; 21 skips e várias suites excluídas pelo comando. Coverage global não é gate implementado. | [.github/scripts/certification-aggregator.mjs](/home/ricardo/cvg-connect-desk/.github/scripts/certification-aggregator.mjs:45) |
| Performance e capacidade demonstrada | 33 | Bundle dentro dos limites declarados; sem execução do perfil de carga e sem percentis de produção. A nota mede comprovação, não lentidão observada. | [.github/scripts/certification-aggregator.mjs](/home/ricardo/cvg-connect-desk/.github/scripts/certification-aggregator.mjs:86) |
| Backup, restore e continuidade | 45 | Scripts de backup/restore existem; verificador aceita fixture parcial e não prova backup externo durável/RPO/RTO. | [infra/scripts/dr-e2e.sh](/home/ricardo/cvg-connect-desk/infra/scripts/dr-e2e.sh:108) |

## 5. Qualidade de código e documentação — 2 itens

| Item | Nota | Avaliação |
|---|---:|---|
| Qualidade TypeScript/lint/build | 84 | 33 checks lint e 33 typecheck passaram sem cache; 6 builds passaram; 105 avisos e páginas extensas permanecem. |
| Consistência e uso da documentação | 50 | Inventário amplo e critérios úteis, mas descrições atuais conflitam com fonte e com outras seções; planos/histórico se misturam. |

**Total: 48 itens principais pontuados**, além de 11 aspectos transversais de UX.

## 6. Achados prioritários e impacto

### A01 — ALTO: hash de senha aparece em respostas administrativas

`GET /admin/users/:id` envia a row completa retornada por `findById`; POST e PUT seguem o mesmo padrão. A listagem projeta campos seguros, mas detalhe/escritas não. `passwordHash` faz parte da row e não há response schema que o remova. O acesso requer permissão administrativa; não se trata de endpoint público anônimo. Ainda assim, disponibilizar hashes ao cliente aumenta a exposição desnecessária de credenciais derivadas.

Evidência estática de caminho completo: `modules/admin/src/presentation/http/admin.controller.ts:64–123`, `modules/admin/src/infrastructure/repositories/admin.repository.ts:13–57`. Não foi consultado hash de usuário real.

**Correção recomendada:** projetar um DTO público e acrescentar teste HTTP negativo em GET/POST/PUT, garantindo ausência do campo.

### A02 — ALTO: reabertura pelo Kanban mantém conversa inativa

A rota permite mover para `novo` ou `em_atendimento`. `updateStatusV2` marca inatividade e data de fechamento ao finalizar, mas não desfaz esses campos ao reabrir. **Reproduzido com o repository real e PostgreSQL descartável**:

```json
{"case":"finalizado -> em_atendimento","status":"open","statusV2":"em_atendimento","isActive":false,"hasClosedAt":true}
```

O vínculo com a rota foi conferido estaticamente: `modules/kanban/src/presentation/http/kanban.controller.ts:271` chama esse método. Consultas que filtram `isActive=true`, como aging, podem omitir a conversa reaberta. [Probe e resultado](evidencias/kanban-probe.log), [fonte da reprodução](evidencias/kanban-probe.ts).

**Correção recomendada:** usar uma transição única que mantenha status, atividade, fechamento e histórico consistentes.

### A03 — ALTO: movimento Kanban pode persistir parcialmente

Status, setor e responsável são atualizados em chamadas separadas (`kanban.controller.ts:271–273`), sem histórico/auditoria/outbox equivalentes ao núcleo operacional. Falha numa escrita posterior deixa a anterior persistida. Esta conclusão é por inspeção do fluxo; não foi injetada falha de FK nesta rodada.

**Correção recomendada:** encaminhar o movimento ao caso de uso transacional do chat, com versão/estado esperado e eventos após commit.

### A04 — ALTO: falta conexão de banco no Compose produtivo do realtime

`docker-compose.yml:232–242` não passa `DATABASE_URL`; o serviço usa outbox de banco por padrão (`apps/realtime-service/src/index.ts:1090`) e autorização consulta o banco (`authorization.ts:45`). Dependência de serviço PostgreSQL em `depends_on` não configura a conexão. A `.dockerignore` exclui `.env` e a imagem não supre essa variável.

**Observado:** ausência na configuração e dependência no código. **Inferido:** falhas de polling/readiness/autorização no Compose entregue. Não foi executado o Compose produtivo. Boot nativo com URL explícita funcionou, portanto não confundir com o antigo defeito de importação.

**Correção recomendada:** configurar a conexão e provar boot/readiness/subscrição autorizada na imagem entregue.

### A05 — ALTO para aceitação de DR: verificador aceita restauração parcial

`infra/scripts/dr-e2e.sh:108–115` lê mensagem, evento e DLQ, mas aceita o JSON se qualquer campo contiver a tag. O predicado aceita `{"message":"dr-fixture-demo","event":null,"dlq":null}`. Isso permite aprovação mesmo sem os registros de outbox/DLQ. Contagens impressas não são assertivas de igualdade. [Reprodução do predicado](evidencias/dr-predicate.json), sem destruição/restauração de banco existente.

**Correção recomendada:** comparar cada identificador e contagem exigidos e injetar ausência de cada entidade para provar que o verificador rejeita.

### A06 — ALTO para o fluxo de trabalho: atalhos da Inbox perdem contexto

A Inbox gera `/tasks?conversationId=...`, `/notes?conversationId=...`, `/alerts?conversationId=...`. As páginas ignoram a query e consultam `/tasks`, `/notes?mine=true` e `/alerts`. **Reproduzido no browser**, com fixture controlada e requisições registradas em [visual-context.json](evidencias/visual-context.json). Fontes: `Inbox.tsx:1950`, `Tasks.tsx:163`, `Notes.tsx:65`, `Alerts.tsx:76`.

**Impacto:** o operador sai do atendimento e recebe uma lista que não corresponde à conversa selecionada. O painel ainda oferece atalhos em vez de apresentar as pendências relacionadas.

**Correção recomendada:** carregar/filtrar o contexto no destino, preencher vínculos de criação e mostrar resumo das pendências na Inbox.

### A07 — MÉDIO: admin e início de atendimento ainda têm escrita parcial

`assignRoles` apaga vínculos antes de inserir os novos, sem transação (`admin.repository.ts:66`). A criação/edição de usuário é separada da atribuição e da auditoria (`admin/application/use-cases/index.ts:27`; controller `:88`). `contacts/application/use-cases/index.ts:43–65` cria conversa e depois histórico, sem outbox/transação abrangente.

**Correção recomendada:** atomicidade por ação, idempotência concorrente e trilha no mesmo commit.

### A08 — MÉDIO: dashboards aceitam entradas inconsistentes

Datas inválidas em `/metrics/conversations/volume` lançam erro genérico; `groupBy` tem tipagem TS, sem validação de runtime consistente. Valores desconhecidos podem cair em agrupamento mensal (`dashboard.controller.ts:90–109`; `dashboard.repository.ts:56`). Outras rotas validam corretamente.

**Correção recomendada:** schemas comuns e respostas 400 previsíveis; definir explicitamente quem pode consultar métricas/detalhes globais. Não classificamos a visão gerencial global como vazamento confirmado sem essa regra de negócio.

### A09 — MÉDIO: prioridade e acabamento móveis

Em 375px, a primeira tarefa começa perto de y=830px e o primeiro alerta crítico perto de y=750px: resumos/filtros ocupam a primeira tela. A sidebar fechada ainda projeta sombra larga sobre conteúdo (`Layout.css:61`). As fontes nomeadas em tokens não são carregadas; `document.fonts` ficou vazio. Notas exige ID manual. Esses pontos reduzem eficiência operacional, apesar de layout e estados já funcionarem.

**Correção recomendada:** priorizar fila/urgência, compactar resumos, remover sombra quando o menu estiver fechado e oferecer seletores contextuais.

### A10 — Lacunas de comprovação para release

O agregador declara coverage global e perfil de carga como pendentes — comportamento correto de bloquear, não falso PASS. Scans cobrem apenas parte das imagens e a identidade escaneada/testada/implantada não está integralmente vinculada. Há métricas e SDK de tracing, mas dashboards provisionáveis e regras de alerta não estão completos. Backup local não demonstra cópia externa durável ou RPO/RTO de operação.

**Correção recomendada:** fechar os gates com o mesmo candidato/imagens, preservando recusas por evidência ausente. Não elevar a nota com novos documentos que apenas repitam intenção.

## 7. Documentação versus programa construído

### Fontes utilizadas e precedência

A visão/escopo (`01`, `02`, `03`) define atendimento operacional veterinário, preservando Gateway/Evolution/Secretary. Arquitetura/domínio/contratos (`04` a `13`) orientam o comportamento esperado; `14` a `19`, ADRs e planos detalham execução/validação. `ARCHITECTURE`, `GAPS-TECNICOS`, `TEST_MATRIX`, `AUTHORIZATION`, `AI_SAFETY`, privacidade, design e critérios R3 foram confrontados com o código atual. Relatórios `23` a `71`, planos de execução e auditorias anteriores são contexto histórico, não prova atual.

Não foram exigidos CRM completo, HIS/prontuário, financeiro, campanhas, omnichannel ou aplicativo móvel nativo: estão fora do escopo definido. Mobile responsivo foi analisado porque a interface web e o brief o exigem.

| Tema documental | Construção observada | Situação |
|---|---|---|
| Desk operacional com Chat/Tasks/Notes/Alerts/Admin/Audit/Dashboard | Módulos e telas existem; testes exercitam vários caminhos. | Implementação substancial, ainda com lacunas A01–A10. |
| Stack antiga Next.js/JWT/BullMQ | React/Vite, sessões opacas e outbox PostgreSQL. | Documentos antigos precisam de reconciliação; diferença de stack não é defeito por si só. |
| Transações e rastreabilidade | Núcleo recente usa transações/outbox; admin/Kanban/contatos ainda têm caminhos divergentes. | Parcial. Não é verdade que o projeto tenha zero transações. |
| Realtime não conectado/eventos em memória | Cliente WS e servidor com outbox/fanout reais. | Afirmações antigas superadas. |
| Boot nativo realtime falha ao importar metrics | Iniciou e consumiu eventos na execução atual. | Defeito histórico não reproduzido neste candidato; Compose tem outro problema. |
| Anonimização legada sem escopo | Rota atual resolve escopo, carrega grafo e recusa fora de escopo. | Afirmação antiga não descreve mais o código; validação integral de privacidade continua pendente. |
| Tasks com erro silencioso | Há ErrorState/retry e testes de estados aprovados. | Documento de design atrasado. |
| Polling de Tasks/Alerts | Páginas carregam inicialmente/após ações, sem polling/subscrição equivalente ao descrito. | Divergência atual; atualização multioperador não comprovada. |
| Contexto lateral de conversa | Contato/vínculos/ações existem; pendências são atalhos que descartam contexto. | Parcial. |
| Tutor–paciente N:N | `patients.tutorId` singular. | Divergência já registrada em D03; não migrada por esta auditoria. |
| Gates de produção/AAA | Parte implementada; coverage global, carga e outros requisitos sem conjunto completo de evidências. | NOT_READY; nota não altera gate. |

O índice `docs/00-meta/README.md` chama R3 de atual no topo, mas adiante recomenda relatórios antigos como os mais recentes e repete limitações já superadas. `docs/05-domain-model.md` também mistura afirmações incompatíveis sobre o que existe no banco. Não basta atualizar a data do cabeçalho: é necessário revisar as afirmações por seção.

Os registros D01–D06 continuam abertos no documento de decisões consultado (permissões, política de dados, relação tutor–paciente, Kanban, ferramentas IA e condições operacionais). Isso não impediu esta auditoria nem os testes sintéticos. Alterações futuras e promoção precisam respeitar o alcance real dessas decisões, sem inferir aprovação a partir de um teste verde.

## 8. Verificações efetivamente executadas

| Check | Resultado atual | Limite |
|---|---|---|
| `pnpm exec turbo run lint --continue --force` | exit 0; 33/33, cache 0, 105 avisos | Não é ausência de dívida de código. |
| `pnpm exec turbo run typecheck --continue --force` | exit 0; 33/33, cache 0 | Checagem estática, não comportamento. |
| `pnpm build --force` | exit 0; 6/6, cache 0 | Só os pacotes com tarefa build; não são 33 imagens construídas. |
| `pnpm db:migrate` com URL descartável explícita | exit 0; migração fresca | Não prova upgrade de instalação existente. |
| `pnpm test:ci`, ambiente inicial | exit 1; API 15 falhas, 41 passes, 121 skips; 19 arquivos falhos | Erros PG 28P01; não atribuir todas as falhas a bugs do produto. Logs preservados. |
| `DATABASE_URL=... REDIS_URL=... TURBO_FORCE=true pnpm test:ci` no ambiente isolado | exit 0; **1209 passes, 21 skips**, 143 arquivos passados e 2 ignorados; Turbo 25/25 sem cache | Mídia depende de serviços ausentes; o script exclui outras suites explicitamente. |
| Testes do agregador de certificação | 51/51 passes | Não prova que workflows remotos ou release passaram. |
| Reabertura de Kanban com repository/PG reais | Bug reproduzido | Caminho HTTP ligado por inspeção, não teste autenticado da rota. |
| Boot nativo realtime em development, porta 5198 | Escutou, assinou Redis, processou eventos e recebeu SIGTERM | `timeout` encerrou o ensaio com exit 124 esperado; não é imagem/produção nem teste de longa duração. |
| Browser 16 rotas × 5 viewports | 80 combinações + 9 registros adicionais; 3 capturas da conversa selecionada | API simulada; estados amostrais. |
| Axe desktop, 16 rotas | Zero violações automáticas; 1 avaliação inconclusiva por rota | Não certifica WCAG, leitor de tela ou todos os estados/dados. |
| Navegação/menu/modais e reduced motion | Checks amostrais passaram; zero animações infinitas ativas em reduced motion | Não cobre todas combinações de teclado/dispositivo. |

[Resultados estruturados](evidencias/results.json), [testes isolados](evidencias/test-ci-isolated.log), [falha inicial](evidencias/test-ci.log), [lint](evidencias/lint-fresh.log), [typecheck](evidencias/typecheck-fresh.log), [build](evidencias/build.log), [migração](evidencias/migrate-isolated.log), [realtime nativo](evidencias/realtime-native-dev.log), [agregador](evidencias/certification-tests.log).

### Interpretação dos testes

A repetição foi motivada por uma causa concreta — conexão de banco inválida — e utilizou uma infraestrutura nova, isolada. Ela não apaga a falha inicial. Na segunda execução, API passou 177 testes; chat, 39; events, 156; realtime, 87; os demais workspaces completam 1.209. Não somar novamente os 269 testes frontend ou os testes dos especialistas: são subconjuntos/execuções sobrepostas.

`test:ci` exclui várias suites `aaa-*` e `production/**`; portanto seu resultado não comprova os 12 gates produtivos. Os 21 testes ignorados são de mídia, distribuídos por 3 arquivos: MinIO (7), fronteira de mídia (8) e ClamAV (6). Dois arquivos foram ignorados por inteiro; o arquivo de ClamAV teve execução parcial. Coverage percentual não foi medido nesta rodada.

### Performance e render

Build atual: JS gzip **120,11 kB decimais** (aprox. 117,29 KiB) e CSS gzip **23,89 kB** (aprox. 23,33 KiB). Cabem nos orçamentos documentados de 120 KiB/25 KiB. Isso não prova LCP/INP/CLS nem capacidade do backend.

O harness nomeia uma seção `production`, mas foi executado em **Vite development**: seus bytes/LCP não foram usados para certificar performance de produção. A captura chamada `200pct` corresponde a viewport 640px e DPR 2, **não a zoom real do navegador**. Nenhuma dessas etiquetas foi promovida a uma prova mais forte.

## 9. Gates de produção: situação nesta auditoria

| Gate R3 | Evidência atual / pendência | Veredito de comprovação |
|---|---|---|
| G01 — baseline/evidência/CI | Manifesto local e testes de agregador; sem conjunto final remoto/imagens. | Parcial |
| G02 — sessão e autorização | Testes/fonte úteis; revisão integral de negativos HTTP/WS de produção não executada. | Parcial |
| G03 — atomicidade/retry/crash | Núcleo testado; Kanban/admin/contatos apresentam caminhos divergentes; crash físico integral não executado. | Não atendido |
| G04 — mídia privada/scan real | Pipeline existe; MinIO/ClamAV específicos não executados. | Não comprovado |
| G05 — dados/IA/privacidade | Migração fresca passou; upgrade, políticas e relações ainda pendentes. | Parcial |
| G06 — atendimento/admin completos | Perda de contexto, hash em resposta e reabertura inconsistente. | Não atendido |
| G07 — visual/a11y | Matriz básica atual, com mocks; estados, zoom e leitor de tela incompletos. | Parcial |
| G08 — qualidade/coverage | Lint/type/build verdes; coverage global e suites excluídas não comprovados. | Parcial |
| G09 — imagens/deploy/readiness | Falta URL de banco no Compose e vínculo integral das imagens. | Não atendido |
| G10 — tracing/métricas/alertas | Fundamentos implementados; ensaio completo e provisionamento faltantes. | Parcial |
| G11 — carga/SQL/vitals/DR | Perfil contratual não executado; verificador DR aceita perda parcial. | Não comprovado |
| G12 — E2E/documentação/crítica | Auditoria atual realizada; E2E real completo e documentação reconciliada pendentes. | Parcial |

O veredito é **NOT_READY**, sustentado por defeitos atuais e evidência obrigatória ausente. Não é uma afirmação de que nenhum fluxo funciona.

## 10. Ordem recomendada para o próximo trabalho

1. **Fechar exposição de hash e corrigir a transição Kanban**, com provas negativas HTTP e persistência real.
2. **Unificar os caminhos transacionais** de Kanban/admin/contatos, incluindo histórico/auditoria/outbox e concorrência.
3. **Corrigir a configuração de banco do realtime** e ensaiar as imagens entregues com readiness e autorização reais.
4. **Preservar o contexto entre páginas**, trocar IDs manuais por seleção e melhorar a prioridade móvel de tarefas/alertas.
5. **Corrigir o verificador DR** e provar backup/restauração duráveis, mídia real, tracing/alertas e carga no mesmo candidato.
6. **Reconciliar a documentação por afirmação**, consolidar as decisões pendentes e repetir a auditoria de release com cobertura e E2E completos.

Não foram estimadas horas ou datas: faltam dados de capacidade e decisões de ambiente. Cada ação acima tem uma lacuna concreta e uma forma observável de comprovar seu fechamento.

## 11. Integridade, revisão independente e limites finais

O [manifesto de fontes](evidencias/source-manifest.json) monitora 617 arquivos selecionados de apps/packages/modules/scripts/.github/infra. A comparação após testes não encontrou alteração. Essa sentinela é delimitada: não monitora todos os bytes do filesystem, declarações/build gerados, nem substitui uma assinatura externa. `git status` já estava amplamente alterado antes da auditoria; nada foi revertido.

Crítica final documental: **APROVADO no escopo declarado**, por crítico independente I1. Cálculos, links, limites de evidência e sentinela conferidos; corrigida a distribuição dos testes ignorados. [Parecer e fechamento](REVISAO.md). Produto permanece NOT_READY.

Não executados nesta rodada: deploy real, WhatsApp/Gateway/Secretary reais, todos os cenários de mídia/scan, suite E2E de produção completa, upgrade de banco existente, restore destrutivo real, carga contratual prolongada, varredura atual de vulnerabilidades externas, leitor de tela, zoom real e estabilidade/SLO de campo. Os containers de teste e servidores temporários usados por esta auditoria são encerrados ao término.

**Conclusão:** produto com base técnica e interface substanciais, apto a continuar validação e correções dirigidas; **a liberação de produção continua sem comprovação suficiente**. O relatório não transforma planos, notas ou artefatos históricos em funcionalidades entregues.
