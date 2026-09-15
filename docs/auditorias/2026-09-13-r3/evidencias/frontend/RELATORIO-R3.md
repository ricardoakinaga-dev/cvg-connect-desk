# Revalidação frontend R3 — scout somente leitura

17/17 achados FE continuam OPEN. Nenhum avanço novo foi identificado nas fontes frontend: 82/82 arquivos comparáveis idênticos à baseline R2, incluindo 77 arquivos de src. A suite identity possui hash atual, sem baseline naquele mapa. Todos 83 arquivos permaneceram iguais durante esta lane.

Renderer Vite próprio em 127.0.0.1:43543, Playwright Chromium por ausência de browser tool. API/mock e usuário sintéticos explicitamente rotulados; nenhuma alegação de E2E. Aplicado design-director em modo design audit, aceites docs/melhorias-2026-09-13 e escopo FE01–17. Fonte/capturas/requests/foco/console registrados.

## Evidência decisiva

- FE01: fechado a 1024 amplia documento para 1318, inert=false e Tab alcança controle invisível. Aberto estabiliza 1024 e Escape devolve foco; o estado fechado ainda falha.
- FE06: navegação SPA via links Inbox→Tarefas→Inbox apaga rascunho sintético.
- FE03: digitar busca fora do lote não gera request e exibe vazio, com contagens locais.
- Capturas atuais inspecionadas confirmam Hoje fixo, anexo como chip, transferência disabled, formulário de tarefa incompleto, ID técnico em notas e tabelas Admin sem editor de papel/membership.

## Status por achado

### FE01 — OPEN · High

Fechado a 1024: scrollWidth=1318, rect x1038/right1318, inert=false e aria-hidden ausente; Tab chega ao botão Abrir cadastro do contato. Aberto estabiliza em 1024 e Escape restaura foco, mas não corrige estado fechado.

Fonte: apps/desk-web/src/pages/Inbox.css:17; apps/desk-web/src/pages/Inbox.tsx:1240.
Evidência: inbox-1024-selected.png; focused-observations.json:closed-drawer-dom/closed-drawer-tab/context-escape-stable.
Restante: Fechar drawer com geometria contida e inert/aria-hidden conforme estado; medir scrollWidth e navegação por Tab nos breakpoints.

### FE02 — OPEN · High

Transferência permanece disabled; contexto mostra status/setor/início/canal e leva a /contacts genérico, sem atribuição/tags/handoff/tarefa/nota contextuais. Não basta backend operacional existir.

Fonte: apps/desk-web/src/pages/Inbox.tsx:1127; apps/desk-web/src/pages/Inbox.tsx:1249.
Evidência: inbox-1440-selected.png; inbox-1024-context-stable.png.
Restante: Implementar atribuição/status/handoff/transferência/tags e links exatos; contexto de tarefa/nota/tutor/paciente via recursos autorizados.

### FE03 — OPEN · High

Busca sintética fora da primeira página gera zero request e mostra Nenhuma conversa; total2 continua derivado do lote. fetchConversations passa setor/limit/cursor; wrapper possui status mas tela não o envia.

Fonte: apps/desk-web/src/pages/Inbox.tsx:335; apps/desk-web/src/pages/Inbox.tsx:880; apps/desk-web/src/pages/Inbox.tsx:894; apps/desk-web/src/lib/api.ts:524.
Evidência: focused-observations.json:server-search; browser-observations.json:requests.
Restante: Levar busca/filtros ao servidor autorizado e distinguir totais globais dos itens carregados.

### FE04 — OPEN · Medium

Histórico sintético de 10/11 setembro continua sob separador literal Hoje em 13 setembro. Não foi auditada ordem da timeline a partir desta fixture.

Fonte: apps/desk-web/src/pages/Inbox.tsx:1161.
Evidência: inbox-375-selected.png; inbox-1440-selected.png.
Restante: Agrupar por data local real e tratar timezone, mudança de dia e empates.

### FE05 — OPEN · High

asset://fixture-doc renderiza exame-luna-fixture.pdf como chip sem link/botão de leitura/download. Componentes/estados de mídia completa e autorização real não demonstrados.

Fonte: apps/desk-web/src/pages/Inbox.tsx:1163; apps/desk-web/src/pages/Inbox.tsx:1164.
Evidência: inbox-1440-selected.png.
Restante: Resolver leitura/download autorizado e estados pending/infected/revogado/expirado; não reconduzir mídia para URL arbitrária.

### FE06 — OPEN · Medium

RASCUNHO SINTETICO R3 desaparece após navegação SPA por links Inbox→Tarefas→Inbox (input vazio). useState/ref local continuam sendo donos de drafts e intenções. Não foi testado401/relogin integrado.

Fonte: apps/desk-web/src/pages/Inbox.tsx:246; apps/desk-web/src/pages/Inbox.tsx:274.
Evidência: focused-observations.json:draft-after-navigation; render-focused.cjs.
Restante: Definir recuperação segura por identidade/conversa durante 401/relogin/navegação; preservar intenção idempotente sem compartilhar dados entre usuários.

### FE07 — OPEN · High

Formulário só oferece título, descrição, prioridade e prazo; payload omite assignee/vínculos. Card mostra 10000000 e não abre conversa vinculada.

Fonte: apps/desk-web/src/pages/Tasks.tsx:129; apps/desk-web/src/pages/Tasks.tsx:357.
Evidência: tasks-create-1440.png; tasks-1440.png.
Restante: Seletores humanos autorizados e edição/links de conversa/tutor/paciente/assignee; provar persistência e atualização.

### FE08 — OPEN · High

Formulário exige ID da referência; card mostra #20000000 sem navegação. Seletores humanos/contextuais não implementados.

Fonte: apps/desk-web/src/pages/Notes.tsx:95; apps/desk-web/src/pages/Notes.tsx:169; apps/desk-web/src/pages/Notes.tsx:243.
Evidência: notes-create-1440.png.
Restante: Pesquisa/seletor por nomes, preseleção contextual e links exatos.

### FE09 — OPEN · High

fetchContactDetail carrega notas apenas para data.conversations[0]?.id; criação também escolhe primeira conversa. Agregação/paginação de todas as conversas não existe nesse caminho.

Fonte: apps/desk-web/src/pages/Contacts.tsx:188; apps/desk-web/src/pages/Contacts.tsx:305; apps/desk-web/src/pages/Contacts.tsx:340.
Evidência: static-evidence.txt.
Restante: Agregar notas de todas conversas autorizadas com procedência e paginação; evitar escolha implícita da primeira conversa.

### FE10 — OPEN · Medium

Alerta sintético tem conversationId/taskId, mas só expõe Reconhecer/Resolver. Não há navegação ao recurso exato.

Fonte: apps/desk-web/src/pages/Alerts.tsx:245; apps/desk-web/src/pages/Alerts.tsx:260.
Evidência: alerts-1440.png.
Restante: Adicionar links autorizados para tarefa/conversa e reconciliar status entre operadores.

### FE11 — OPEN · High

ContactGroups lista membros sem mutação e orienta adicionar pela ficha; Contacts mostra badges sem controle correspondente de membership. Não há novo caminho frontend.

Fonte: apps/desk-web/src/pages/ContactGroups.tsx:354; apps/desk-web/src/pages/ContactGroups.tsx:363; apps/desk-web/src/pages/Contacts.tsx:452.
Evidência: static-evidence.txt.
Restante: Conectar ações adicionar/remover membros e labels; editar grupo/setor conforme permissões e invalidar consultas.

### FE12 — OPEN · Medium

Estado/formulário/payload de Patients mantêm tutorId singular. N:N e ratificação D03 não podem ser considerados entregues pela UI.

Fonte: apps/desk-web/src/pages/Patients.tsx:68; apps/desk-web/src/pages/Patients.tsx:144; apps/desk-web/src/pages/Patients.tsx:322.
Evidência: static-evidence.txt.
Restante: Resolver D03 e adaptar API/UI/migração compatível a múltiplos tutores; não declarar N:N entregue.

### FE13 — OPEN · High

Usuários mantêm editor Setores e delete; papéis exibem nome/descrição/delete, sem editor de capacidades ou vínculo usuário↔papel. Filas/times continuam tabelas simples sem gestão completa de membros.

Fonte: apps/desk-web/src/pages/Admin.tsx:739; apps/desk-web/src/pages/Admin.tsx:745; apps/desk-web/src/pages/Admin.tsx:756.
Evidência: admin-correct-fixture-1440.png; admin-roles-1440.png.
Restante: Manter editor de setores existente, adicionar editor por capacidade efetiva, associação papel e membros com audit/revogação.

### FE14 — OPEN · High

Kanban possui drag/select de mudança de status e filtro setor; card não abre conversa e faltam filtros agente/label/prioridade/período/grupo.

Fonte: apps/desk-web/src/pages/Kanban.tsx:92; apps/desk-web/src/pages/Kanban.tsx:265.
Evidência: kanban-1440.png.
Restante: Conectar deep-link de conversa e filtros agente/label/prioridade/período/grupo; manter alternativa teclado e feedback de falha.

### FE15 — OPEN · High

Tasks/Alerts/Contacts/Kanban/Dashboard continuam fetch inicial, mutação ou refresh manual. Não há assinatura realtime/polling bounded nessas páginas; timers de feedback/debounce não atualizam dados de outro operador.

Fonte: apps/desk-web/src/pages/Tasks.tsx:84; apps/desk-web/src/pages/Alerts.tsx:76; apps/desk-web/src/pages/Contacts.tsx:198; apps/desk-web/src/pages/Kanban.tsx:108; apps/desk-web/src/pages/Dashboard.tsx:37.
Evidência: static-evidence.txt.
Restante: Invalidação ou polling limitado e estado stale/offline; preservar formulário sujo e reconciliar reconexão.

### FE16 — OPEN · Medium

Inbox 1254 linhas/Admin 1342/Contacts 682; apps/desk-web/src/features não existe e loadFailureFrom continua repetido. Primitivos/tokens existentes não fecham extração por ownership.

Fonte: apps/desk-web/src/pages/Inbox.tsx:1; apps/desk-web/src/pages/Admin.tsx:1; apps/desk-web/src/pages/Contacts.tsx:1.
Evidência: source-hashes-before.json; static-evidence.txt.
Restante: Extrações por ownership real de consultas/mutações e adoção de primitivos; preservar comportamento em capturas equivalentes.

### FE17 — OPEN · Medium

e2e/production contém apenas 01-harness-identity.spec.ts; config production inclui suites AAA existentes, mas não os novos percursos completos. reuseExistingServer:!CI permanece. Stack real não executado por esta lane.

Fonte: playwright.production.config.ts:41; e2e/production/01-harness-identity.spec.ts:1.
Evidência: static-evidence.txt.
Restante: Criar cenário de atendimento com serviços isolados identificados e impedir reutilização sem prova de identidade; esta auditoria não executou o stack.

## Progresso existente preservado

- Boot espera /auth/me antes da consulta operacional na fixture; deep-link admin sem capacidade exibe Acesso negado; erro de rede oferece retry.
- Shell mobile: Escape restaura foco Abrir navegação e sidebar fechada inert.
- Contexto aberto: Escape restaura foco Abrir informações da conversa; esta melhoria já existente não resolve FE01 fechado.
- Primitivos/tokens, estados de erro/retry, select acessível Kanban e editor de setores Admin existentes foram preservados.

## Limites

- API inteiramente sintética via route; screenshots provam somente UI atual. Nenhum E2E/backend/DB/autorização real/provider/scanner/persistência/realtime remoto validado.
- WebSockets fechados propositalmente para não acessar servidor externo/preexistente. Mensagens de erro HMR Vite e banner de reconexão são efeitos do harness, não defeitos novos de produto.
- Nenhum pageerror observado; auth offline gera ERR_FAILED intencional.
- Captura inbox-1024-context.png foi colhida durante transição e não é usada para geometria aberta final: substituída por inbox-1024-context-stable.png com 450 ms de estabilização.
- Matriz parcial: Inbox375/1024/1440 e páginas adjacentes desktop; não 16 rotas×5 viewports, fronteiras, zoom/reflow, contraste ou leitor de tela real. Não concede G07/G12/AAA.
- Fixture histórica de mensagens não constitui prova de ordenação/empates/timezone completo. FE04 limita-se a Hoje literal sobre dias anteriores.
- Baseline R2 é sources-before.json arquivado em /tmp/cvg-audit-deliveries-ufq9_ejh, não apenas gitHEAD; árvore preexistente contém modificações.77 arquivos src e5 configurações/lock comparáveis idênticos; suite identity tem hash atual, sem baseline naquele mapa.
- Tentativas de startup iniciais falharam por path vite raiz e bundling CJS; comando bem-sucedido usa apps/desk-web/node_modules/vite/bin/vite.js e --configLoader native. Sem mudança produtiva.

## Handoff

Artefatos: findings-r3.json, source-hashes-before.json, source-hashes-after.json, runtime.json, browser-observations.json, browser-auth-admin.json, focused-observations.json, static-evidence.txt e capturas PNG. Novos testes unitários/build são responsabilidade da lane lead; nenhum resultado unitário inferido aqui.

Prioridade restante: corrigir drawer/foco e completar operação/contexto usando contratos backend já entregues; depois timeline/mídia/recuperação, formulários humanos/vínculos, memberships/admin, sincronização e E2E real. Não reimplementar capacidades backend com base na ausência de UI.

Renderer encerrado: SIGTERM somente no PID próprio 1277530; porta 43543 fechada confirmada em runtime.json.
