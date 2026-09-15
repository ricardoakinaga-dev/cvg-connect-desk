# Scout frontend — CVG Connect Desk

Avaliação somente leitura usando design-director (quality-rubric/visual-qa), CRITERIOS.md e cards PROD17/19–30/38. Público: operador de atendimento veterinário. Meio: aplicação React/Vite real com API sintética interceptada. Sem alteração de produto/docs. Este parecer não é a crítica independente final.

## Evidência atual

Playwright 1.59.1, Chromium headless, Vite7.3.6 próprio em 127.0.0.1:32893; config com envDir vazio (nenhum .env carregado), cache em /tmp, token fictício. Scripts render.cjs/render-auth.cjs e JSON browser-observations.json/browser-auth-admin.json preservam fixtures, consultas, console, geometria e texto. 22 capturas PNG com hashes no findings.json. Capturas selecionadas foram abertas e inspecionadas visualmente; não foram apenas geradas.

Inbox: 375×812,1024×768,1440×900, lista/seleção e contexto tablet. Adicionais: tasks/notes/alerts/admin/kanban/contacts desktop; criação tarefas/notas; boot aguardando/confirmado, erro de rede, deep-link negado e shell mobile aberto/Escape. Não constitui matriz completa do PROD29.

## Avanços confirmados

- PROD17: com /auth/me atrasado, única consulta observada antes da resposta foi /auth/me; nenhuma conversa/contato/setor foi solicitado. Após confirmação, Inbox liberado.
- Principal com apenas chat:read não vê Administração e deep-link /admin mostra Acesso negado; tentativa de rede falha mostra retry mantendo fronteira fechada.
- Shell mobile: drawer aberto funciona; Escape devolveu foco a Abrir navegação e sidebar recebeu inert. Estados de conexão mostram instabilidade real do harness, não online fictício.
- Layout desktop possui hierarquia e navegação consistente; nomes/estado são legíveis. Composer apresenta erro/estado de envio e chave por intenção no código; Kanban oferece select alternativo ao drag; páginas usam componentes de loading/erro/vazio.

## Situação por card

| Card | Estado do scout | Fundamentação |
|---|---|---|
| PROD-17 | PARTIAL_VERIFIED | Boot aguardou /auth/me, sem consultas operacionais antes; deep-link sem capacidade negado; erro de rede recuperável; mobile Escape retorna foco e sidebar inert. 401/403 reais, rotação/WS/cache e principal alterado integrados NOT_RUN. |
| PROD-19 | FAIL | AC1–3 incompletos FE02/03; AC4 parcial (polling Inbox presente), integração concorrente NOT_RUN. |
| PROD-20 | FAIL | AC1/2 falham FE04/05; AC3 parcial FE06; WSS remoto/upload/cancelamento integrados NOT_RUN. |
| PROD-21 | FAIL | AC1/2 incompletos FE07; AC3 não tem invalidação FE15; AC4 HTTP+PG NOT_RUN. |
| PROD-22 | FAIL | AC1/3 falham FE08/09; autoria server-side não retestada; AC4 parcial, formulário renderizado. |
| PROD-23 | PARTIAL | Ack/resolve renderizados; links e atualização faltam FE10/15. Geração/dedup/scheduler backend fora do scout. |
| PROD-24 | FAIL | AC1 incompleto FE11; edição/revogação/membership HTTP+browser NOT_RUN. |
| PROD-25 | FAIL | AC2 incompleto FE09; AC5 N:N ausente FE12; D03 consta OPEN, não ratificação presumida. |
| PROD-26 | FAIL | AC1/2/5 incompletos FE13; editor setor existente. D05 OPEN, ausência de aprovação IA fictícia é correta. Audit/revogação integradas NOT_RUN. |
| PROD-27 | FAIL | AC1 navegação e AC2 filtros incompletos FE14; alternativa select presente; sincronização FE15; D04 OPEN. |
| PROD-28 | PARTIAL | Primitivos e tokens existem; extração/ownership e ledger não fechados FE16; antes/depois não aplicável ao scout. |
| PROD-29 | FAIL | AC1 reproduzido FE01. AC2 matriz parcial (não todas 16 rotas×5); leitor de tela/contraste/zoom/motion AC3 NOT_RUN. Capturas nativas e JSON existentes, não crítica final. |
| PROD-30 | FAIL | AC1 atualização ausente FE15; KPI backend/PG AC2/3 não avaliado nesta lane. |
| PROD-38 | NOT_RUN | Apenas browser sintético com mocks; nenhum percurso serviços reais, nenhum aceite integrado concedido FE17. |

## Achados e backlog recomendado

### FE01 — High — Drawer fechado amplia Inbox 1024 para 1318 pixels e continua no DOM acessível
Cards: PROD-29. Evidência: inbox-1024-selected.png; browser-observations.json: geometry 1318/1024. Fonte: `apps/desk-web/src/pages/Inbox.css:17; apps/desk-web/src/pages/Inbox.tsx:1240`. Estado: BROWSER+STATIC, confiança HIGH.

Fechar drawer com geometria contida e inert/aria-hidden conforme estado; medir scrollWidth e navegação por Tab nos breakpoints.

### FE02 — High — Operação no contexto incompleta: transferência desabilitada; cadastro abre lista genérica
Cards: PROD-19. Evidência: inbox-1440-selected.png. Fonte: `apps/desk-web/src/pages/Inbox.tsx:1127; apps/desk-web/src/pages/Inbox.tsx:1249`. Estado: BROWSER+STATIC, confiança HIGH.

Implementar atribuição/status/handoff/transferência/tags e links exatos; contexto de tarefa/nota/tutor/paciente via recursos autorizados.

### FE03 — High — Busca e contagens consideram apenas conversas carregadas; parâmetros de consulta não incluem busca/status/responsável/labels
Cards: PROD-19. Evidência: render.cjs fixture anuncia segunda página; browser-observations.json registra consultas. Fonte: `apps/desk-web/src/pages/Inbox.tsx:335; apps/desk-web/src/pages/Inbox.tsx:880; apps/desk-web/src/pages/Inbox.tsx:894`. Estado: STATIC, confiança HIGH.

Levar busca/filtros ao servidor autorizado e distinguir totais globais dos itens carregados.

### FE04 — Medium — Timeline rotula qualquer histórico como Hoje
Cards: PROD-20. Evidência: inbox-375-selected.png e inbox-1440-selected.png; fixture usa 10/11 setembro. Fonte: `apps/desk-web/src/pages/Inbox.tsx:1162`. Estado: BROWSER+STATIC, confiança HIGH.

Agrupar por data local real e tratar timezone, mudança de dia e empates.

### FE05 — High — asset:// é chip sem ação; documento/vídeo não têm componente de leitura completo
Cards: PROD-20. Evidência: inbox-1440-selected.png, arquivo exame-luna-fixture.pdf sem botão/link. Fonte: `apps/desk-web/src/pages/Inbox.tsx:1164`. Estado: BROWSER+STATIC, confiança HIGH.

Resolver leitura/download autorizado e estados pending/infected/revogado/expirado; não reconduzir mídia para URL arbitrária.

### FE06 — Medium — Rascunhos e intenções existem só em memória do Inbox; sair/remontar perde estado
Cards: PROD-20. Evidência: Inspeção state/ref, nenhuma persistência por conversa na página. Fonte: `apps/desk-web/src/pages/Inbox.tsx:246; apps/desk-web/src/pages/Inbox.tsx:274`. Estado: STATIC, confiança HIGH.

Definir recuperação segura por identidade/conversa durante 401/relogin/navegação; preservar intenção idempotente sem compartilhar dados entre usuários.

### FE07 — High — Tarefa não permite atribuição/vínculos no formulário nem abrir conversa do card
Cards: PROD-21. Evidência: tasks-create-1440.png: apenas título/descrição/prioridade/prazo; assignee 10000000. Fonte: `apps/desk-web/src/pages/Tasks.tsx:129; apps/desk-web/src/pages/Tasks.tsx:357`. Estado: BROWSER+STATIC, confiança HIGH.

Seletores humanos autorizados e edição/links de conversa/tutor/paciente/assignee; provar persistência e atualização.

### FE08 — High — Nota exige ID técnico e apresenta referência truncada sem navegação
Cards: PROD-22. Evidência: notes-create-1440.png: ID da referência e #20000000. Fonte: `apps/desk-web/src/pages/Notes.tsx:95; apps/desk-web/src/pages/Notes.tsx:170; apps/desk-web/src/pages/Notes.tsx:243`. Estado: BROWSER+STATIC, confiança HIGH.

Pesquisa/seletor por nomes, preseleção contextual e links exatos.

### FE09 — High — Ficha de contato carrega/cria notas apenas na primeira conversa
Cards: PROD-22, PROD-25. Evidência: Inspeção do caminho loadContactNotes e criação. Fonte: `apps/desk-web/src/pages/Contacts.tsx:188; apps/desk-web/src/pages/Contacts.tsx:305`. Estado: STATIC, confiança HIGH.

Agregar notas de todas conversas autorizadas com procedência e paginação; evitar escolha implícita da primeira conversa.

### FE10 — Medium — Alertas têm ack/resolve mas não navegam ao recurso relacionado
Cards: PROD-23. Evidência: alerts-1440.png: fixture tem conversationId/taskId, sem link. Fonte: `apps/desk-web/src/pages/Alerts.tsx:105; apps/desk-web/src/pages/Alerts.tsx:245`. Estado: BROWSER+STATIC, confiança HIGH.

Adicionar links autorizados para tarefa/conversa e reconciliar status entre operadores.

### FE11 — High — Grupos só exibem membros; instrução para adicionar pela ficha não corresponde a controle ali
Cards: PROD-24. Evidência: ContactGroups mostra membros e texto de orientação; Contacts apenas renderiza badges grupos/labels. Fonte: `apps/desk-web/src/pages/ContactGroups.tsx:354; apps/desk-web/src/pages/ContactGroups.tsx:363; apps/desk-web/src/pages/Contacts.tsx:452`. Estado: STATIC, confiança HIGH.

Conectar ações adicionar/remover membros e labels; editar grupo/setor conforme permissões e invalidar consultas.

### FE12 — Medium — Paciente ainda usa tutorId singular; N:N não representado pela UI
Cards: PROD-25. Evidência: Formulário e payload com tutorId único. Fonte: `apps/desk-web/src/pages/Patients.tsx:68; apps/desk-web/src/pages/Patients.tsx:144; apps/desk-web/src/pages/Patients.tsx:322`. Estado: STATIC, confiança HIGH.

Resolver D03 e adaptar API/UI/migração compatível a múltiplos tutores; não declarar N:N entregue.

### FE13 — High — Admin não possui editor de permissões por papel/vínculo usuário-papel nem gestão completa de membros de times/filas
Cards: PROD-26. Evidência: admin-correct-fixture-1440.png; admin-roles-1440.png. Fonte: `apps/desk-web/src/pages/Admin.tsx:739; apps/desk-web/src/pages/Admin.tsx:745`. Estado: STATIC, confiança HIGH.

Manter editor de setores existente, adicionar editor por capacidade efetiva, associação papel e membros com audit/revogação.

### FE14 — High — Kanban move por select/drag, mas card não abre conversa e só há filtro de setor
Cards: PROD-27. Evidência: kanban-1440.png; card sem anchor/onClick de navegação. Fonte: `apps/desk-web/src/pages/Kanban.tsx:92; apps/desk-web/src/pages/Kanban.tsx:265`. Estado: BROWSER+STATIC, confiança HIGH.

Conectar deep-link de conversa e filtros agente/label/prioridade/período/grupo; manter alternativa teclado e feedback de falha.

### FE15 — High — Tasks/Alerts/Contacts/Kanban/Dashboard não assinam realtime nem executam polling bounded
Cards: PROD-30. Evidência: Busca por setInterval/realtime/addEventListener nessas páginas sem ocorrência; fetch inicial/mutação/manual. Fonte: `apps/desk-web/src/pages/Tasks.tsx:84; apps/desk-web/src/pages/Alerts.tsx:76; apps/desk-web/src/pages/Kanban.tsx:108`. Estado: STATIC, confiança HIGH.

Invalidação ou polling limitado e estado stale/offline; preservar formulário sujo e reconciliar reconexão.

### FE16 — Medium — Monólitos de página e duplicação de estados continuam; features/inbox ausente
Cards: PROD-28. Evidência: Inbox1254 linhas, Admin1342, Contacts682; loadFailureFrom repetido. Fonte: `apps/desk-web/src/pages/Inbox.tsx:1; apps/desk-web/src/pages/Admin.tsx:1; apps/desk-web/src/pages/Contacts.tsx:1`. Estado: STATIC, confiança HIGH.

Extrações por ownership real de consultas/mutações e adoção de primitivos; preservar comportamento em capturas equivalentes.

### FE17 — Medium — Percurso E2E produção completo não está implementado na pasta de suites
Cards: PROD-38. Evidência: e2e/production contém somente 01-harness-identity.spec.ts; config permite reuseExistingServer local. Fonte: `playwright.production.config.ts:41; e2e/production/01-harness-identity.spec.ts:1`. Estado: STATIC, confiança HIGH.

Criar cenário de atendimento com serviços isolados identificados e impedir reutilização sem prova de identidade; esta auditoria não executou o stack.

## Prioridade sugerida

1. FE01 + FE02/03 + FE04/05: corrigir geometria e completar caminho principal de atendimento, timeline e leitura segura.
2. FE07–FE15: fechar contexto de tarefas/notas/alertas, CRUD de memberships/admin e sincronização entre operadores.
3. FE16: extrair componentes/consultas durante as entregas, sem reescrita geral; depois fechar matriz visual e FE17 com serviços reais.

## Limites e honestidade de evidência

- Mocks prove frontend behavior only; no backend authz/persistence/provider/scanner/realtime guarantee
- Partial responsive matrix; screen reader, contrast, zoom/reflow, vitals NOT_RUN
- Initial admin-1440.png is INVALID_FIXTURE: mock returned entries rather than expected data/stats; corrected in admin-correct-fixture-1440.png; not counted as product failure
- Initial Vite dev WS attempted localhost:8080 and was refused; second harness intercepts all WebSockets. No existing server used. No real data.
- Canonical message fixture provided ascending input where API may use descending; no message-order defect claimed from captures.
- Root executa unit/typecheck/lint; não duplicados por este scout. Não foi conferida cobertura/CI nesta lane.
- D03/D04/D05 continuam OPEN nos documentos lidos. Isso impede afirmar escopo ratificado, sem impedir correções independentes.
- Não emitida nota AAA global: há falhas High observadas e vários requisitos obrigatórios NOT_RUN.

Veredito: frontend substancial e PROD17 avançado; PROD19–30 não estão completos para os critérios declarados. Interrompida investigação após evidência suficiente para backlog reproduzível, sem correções por tratar-se de scout.

## Inventário do render

Todos os endpoints abaixo foram interceptados pelo browser, sem backend: `/admin/dead-letters`, `/admin/dead-letters/stats`, `/admin/queues`, `/admin/roles`, `/admin/teams`, `/admin/users`, `/admin/webhook-security/stats`, `/alerts`, `/auth/me`, `/contacts`, `/conversations`, `/conversations/20000000-0000-0000-0000-000000000001/messages`, `/conversations/20000000-0000-0000-0000-000000000001/read`, `/kanban/board`, `/notes`, `/sectors`, `/tasks`. Respostas e shapes exatos em render.cjs/render-auth.cjs; requisições não especificadas retornam [] sintético.

Rasters efetivamente inspecionados pelo scout: inbox-1024-selected.png, inbox-375-selected.png, inbox-1440-selected.png, tasks-create-1440.png, notes-create-1440.png, alerts-1440.png, admin-1440.png (invalid fixture), admin-correct-fixture-1440.png, kanban-1440.png, auth-boot-pending-1440.png, auth-deeplink-denied-1440.png, auth-offline-retry-1440.png, shell-mobile-nav-open.png. Demais PNG são capturados mas não recebem alegação de julgamento visual individual.
