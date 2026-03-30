# PROMPT MASTER — IMPLEMENTAÇÃO ENTERPRISE COMPLETA — CVG CONNECT DESK

## PAPEL DO EXECUTOR

Você é o executor principal de engenharia responsável por implementar o sistema **CVG Connect Desk** em nível enterprise.

Seu trabalho NÃO é discutir arquitetura de forma abstrata.
Seu trabalho é **construir, endurecer, integrar, validar e documentar**.

Você deve atuar como um executor técnico sênior com responsabilidade de entrega real.

---

## OBJETIVO DO PROJETO

Implementar um novo sistema chamado **CVG Connect Desk**, que será uma plataforma proprietária de atendimento, operação e relacionamento para hospital veterinário.

O sistema deve substituir progressivamente a camada operacional hoje associada ao Chatwoot, sem quebrar a operação existente, reaproveitando a infraestrutura já disponível.

O novo sistema deve aproveitar:

* gateway já existente
* integração atual com Evolution API
* integração já projetada para Agent Secretary
* endpoints já existentes usados hoje com Chatwoot / Secretary

O novo sistema NÃO deve começar do zero ignorando a realidade atual.
Ele deve ser construído sobre a infraestrutura existente, com compatibilidade progressiva.

---

## REGRA MÁXIMA DE EXECUÇÃO

Você NÃO pode produzir resposta genérica.
Você NÃO pode entregar plano vago.
Você NÃO pode deixar decisões estruturais importantes sem implementação.
Você NÃO pode responder com sugestões superficiais.

Você deve:

1. criar a documentação completa em `/docs`
2. criar a estrutura real do projeto
3. implementar por fases
4. preservar compatibilidade com a integração atual
5. não quebrar o gateway existente
6. não reescrever a Agent Secretary nesta fase
7. registrar decisões, progresso, pendências e validações em arquivos `.md`

---

## CONTEXTO ARQUITETURAL OBRIGATÓRIO

A arquitetura real deve considerar o seguinte fluxo:

WhatsApp
→ Evolution API
→ Gateway existente
→ CVG Connect Desk
→ Agent Secretary
→ resposta ao cliente

O gateway existente já está em uso com Chatwoot e Secretary.
A Secretary foi projetada para integrar com Chatwoot.
Os mesmos endpoints atuais devem ser reaproveitados quando possível.

A estratégia correta é:

* manter o gateway
* manter os contratos atuais o máximo possível
* criar o novo sistema por trás de uma camada própria
* construir uma compatibilidade Chatwoot-like apenas onde necessário
* migrar gradualmente a operação para a nova interface

---

## RESULTADO FINAL ESPERADO

Ao final da implementação, o projeto deve possuir:

* backend principal funcional
* frontend desk funcional
* integração com gateway funcional
* módulo de conversas funcional
* módulo de tarefas funcional
* módulo de notas internas funcional
* módulo de alertas funcional
* módulo administrativo funcional
* módulo de auditoria funcional
* dashboard inicial funcional
* integração controlada com Agent Secretary
* documentação de arquitetura, contrato, roadmap, decisões e validações em `/docs`

---

## STACK OBRIGATÓRIA

Você deve usar a stack abaixo, salvo se o repositório já possuir convenção estrutural equivalente e melhor integrada.

### Backend

* Node.js
* TypeScript
* Fastify
* PostgreSQL
* Redis
* BullMQ
* WebSocket ou SSE para realtime

### Frontend

* Next.js
* React
* TypeScript
* biblioteca de componentes consistente com o projeto existente, preferencialmente com padrão limpo e administrativo

### Infra

* Docker
* Docker Compose
* variáveis por `.env`
* scripts de desenvolvimento e produção
* estrutura preparada para EasyPanel ou Docker puro, sem acoplamento desnecessário

---

## DOMÍNIOS OBRIGATÓRIOS DO SISTEMA

O sistema deve ser construído com estes domínios reais:

1. chat
2. tasks
3. notes
4. alerts
5. admin
6. audit
7. dashboard
8. integrations
9. secretary-adapter
10. chatwoot-compat somente se realmente necessário para preservar contratos legados

---

## DIRETRIZES DE IMPLEMENTAÇÃO

### 1. NÃO QUEBRAR O QUE JÁ EXISTE

Não remover integração atual.
Não assumir que o gateway será alterado.
Não exigir reescrita da Secretary para o sistema funcionar.

### 2. IMPLEMENTAR COMPATIBILIDADE

Onde a Secretary depender de contratos parecidos com Chatwoot, criar camada de adaptação.
Não espalhar regras legadas pelo sistema inteiro.
Centralizar compatibilidade em adapter.

### 3. MODULARIDADE REAL

Separar backend por módulos/domínios reais.
Evitar acoplamento direto entre chat, tasks, notes, alerts e admin.
Compartilhar apenas contratos internos e serviços de infraestrutura.

### 4. DOCUMENTAÇÃO OBRIGATÓRIA

Tudo deve ser documentado em `/docs`.
Cada fase concluída deve atualizar a documentação.
Cada decisão importante deve ficar registrada.

### 5. EXECUÇÃO INCREMENTAL

Entregar em etapas funcionais.
Cada fase deve terminar com sistema validável.
Não deixar tudo pela metade para “resolver depois”.

---

## ESTRUTURA DE PASTAS OBRIGATÓRIA

Se o repositório ainda não estiver preparado, crie a seguinte estrutura base ou equivalente muito próxima, respeitando convenções já existentes quando fizer sentido:

```text
/docs
  01-product-vision.md
  02-business-context.md
  03-scope-and-non-scope.md
  04-target-architecture.md
  05-domain-model.md
  06-integration-contracts.md
  07-backend-architecture.md
  08-frontend-architecture.md
  09-data-model.md
  10-realtime-and-events.md
  11-security-and-access-control.md
  12-audit-and-observability.md
  13-dashboard-and-kpis.md
  14-roadmap.md
  15-implementation-phases.md
  16-validation-checklist.md
  17-open-decisions.md
  18-deployment-and-runtime.md
  19-test-strategy.md
  20-master-execution-log.md

/apps
  /desk-api
  /desk-web

/packages
  /shared
  /database
  /auth
  /events
  /realtime
  /integrations

/modules
  /chat
  /tasks
  /notes
  /alerts
  /admin
  /audit
  /dashboard
  /secretary-adapter
  /chatwoot-compat

/infra
  /docker
  /scripts
```

Se a estrutura existente do repositório for monorepo já consolidado, adapte sem destruir o padrão do projeto, mas preserve separação clara de domínios.

---

## DOCUMENTAÇÃO QUE VOCÊ DEVE CRIAR EM `/docs`

### `/docs/01-product-vision.md`

Descrever o produto, objetivo, visão, perfis de usuário, problema resolvido, valor para hospital veterinário.

### `/docs/02-business-context.md`

Descrever contexto operacional do hospital, uso com clientes, atendimento, operação interna, fluxo humano + IA, dependência de WhatsApp, gateway, Secretary.

### `/docs/03-scope-and-non-scope.md`

Definir claramente o que entra nesta primeira implementação e o que explicitamente não entra agora.

### `/docs/04-target-architecture.md`

Descrever arquitetura final desejada com fluxos, serviços, integrações, componentes, fronteiras e adapters.

### `/docs/05-domain-model.md`

Definir domínios, agregados, entidades, responsabilidades e relações.

### `/docs/06-integration-contracts.md`

Definir contratos de integração com gateway, Evolution API, Secretary e camada compat legada.

### `/docs/07-backend-architecture.md`

Definir estrutura do backend, módulos, camadas, serviços, filas, eventos, adapters, patterns internos.

### `/docs/08-frontend-architecture.md`

Definir telas, rotas, layout, estados, UX operacional, sidebar, inbox, painel lateral, admin, dashboard.

### `/docs/09-data-model.md`

Definir modelo relacional inicial, tabelas, chaves, índices, constraints e justificativas.

### `/docs/10-realtime-and-events.md`

Definir como inbound, outbound, realtime, fila, retry, idempotência e atualização de inbox vão funcionar.

### `/docs/11-security-and-access-control.md`

Definir autenticação, RBAC, permissões, controle de acesso, segredo de webhooks, segregação de responsabilidades.

### `/docs/12-audit-and-observability.md`

Definir trilha de auditoria, logs, métricas, erros, eventos sensíveis e monitoramento.

### `/docs/13-dashboard-and-kpis.md`

Definir dashboard operacional, dashboard IA, dashboard comercial inicial e dashboard gerencial.

### `/docs/14-roadmap.md`

Definir roadmap por fase.

### `/docs/15-implementation-phases.md`

Transformar o roadmap em execução prática, com ordem técnica, dependências, entregáveis, risco e critério de pronto.

### `/docs/16-validation-checklist.md`

Checklist objetivo de validação por módulo e por fase.

### `/docs/17-open-decisions.md`

Lista de decisões ainda abertas, se existirem, com impacto e recomendação. Evitar abrir muitas frentes desnecessárias.

### `/docs/18-deployment-and-runtime.md`

Definir runtime, variáveis, Docker, Compose, portas, jobs, workers, ambiente dev e prod.

### `/docs/19-test-strategy.md`

Definir estratégia mínima de testes: unitário, integração, contratos críticos, smoke tests.

### `/docs/20-master-execution-log.md`

Arquivo vivo obrigatório.
Registrar o que foi criado, editado, concluído, pendências, riscos encontrados e próximos passos.

---

## MÓDULOS OBRIGATÓRIOS E REGRAS DE CADA UM

## MÓDULO 1 — CHAT

Implementar o núcleo de conversação.

### Escopo obrigatório

* lista de conversas
* detalhes da conversa
* mensagens inbound e outbound
* status da conversa
* atribuição de responsável
* tags
* anexos preparados na modelagem mesmo que mídia completa evolua depois
* suporte a handoff bot/humano
* vinculação com canal e contato

### Entidades mínimas

* conversations
* messages
* conversation_participants
* conversation_assignments
* conversation_tags
* message_attachments
* conversation_status_history

### Regras obrigatórias

* inbound recebido do gateway não pode gerar duplicação
* outbound deve registrar origem
* toda troca de status deve ficar auditável
* cada conversa deve ter referência de canal, contato e timestamps principais
* modelo deve suportar expansão futura sem refactor destrutivo

---

## MÓDULO 2 — TASKS

Implementar tarefas internas vinculadas à operação.

### Escopo obrigatório

* criar tarefa a partir de conversa
* listar tarefas
* alterar status
* prioridade
* responsável
* prazo
* origem da tarefa
* vínculo com conversa, tutor ou paciente quando aplicável

### Entidades mínimas

* tasks
* task_status_history
* task_comments

### Regras obrigatórias

* tarefa deve poder nascer de uma conversa
* tarefa deve ser rastreável na auditoria
* tarefa vencida deve poder alimentar alerta

---

## MÓDULO 3 — NOTES

Implementar notas internas.

### Escopo obrigatório

* criar nota interna
* listar notas por entidade relacionada
* notas vinculadas a conversa
* notas vinculadas a tutor
* notas vinculadas a paciente
* controle de autoria e timestamp

### Entidades mínimas

* internal_notes

### Regras obrigatórias

* nota interna nunca pode ser confundida com mensagem do cliente
* nota deve ter tipo ou reference_type claro
* nota deve ser auditável

---

## MÓDULO 4 — ALERTS

Implementar alertas operacionais.

### Escopo obrigatório

* alertas automáticos e manuais
* severidade
* origem
* reconhecimento do alerta
* resolução do alerta
* listagem de alertas ativos

### Exemplos iniciais obrigatórios

* conversa sem resposta dentro do SLA
* tarefa vencida
* conversa sem responsável
* falha de integração crítica
* handoff pendente há muito tempo

### Entidades mínimas

* alerts
* alert_events

### Regras obrigatórias

* alerta deve ter lifecycle claro
* alerta deve poder apontar para conversa, tarefa ou integração
* alerta reconhecido não deve sumir da trilha histórica

---

## MÓDULO 5 — ADMIN

Implementar governança do sistema.

### Escopo obrigatório

* usuários internos
* perfis
* permissões
* filas
* times
* macros ou templates iniciais
* configurações mínimas de operação

### Entidades mínimas

* users
* roles
* permissions
* user_roles
* queues
* teams
* macros

### Regras obrigatórias

* RBAC real, não fake
* não usar permissão hardcoded espalhada
* centralizar autorização

---

## MÓDULO 6 — AUDIT

Implementar trilha de auditoria.

### Escopo obrigatório

Registrar:

* criação e edição de conversa quando aplicável
* envio de mensagem
* mudança de status
* atribuição
* criação/edição de tarefa
* criação de nota
* reconhecimento e resolução de alerta
* mudança administrativa relevante
* ativação/desativação de bot/handoff quando isso ocorrer

### Entidades mínimas

* audit_logs

### Regras obrigatórias

* registrar ator, ação, entidade, entidade_id, timestamp, metadados essenciais
* permitir consulta operacional posterior

---

## MÓDULO 7 — DASHBOARD

Implementar dashboards iniciais.

### Escopo obrigatório

* total de conversas abertas
* tempo médio de primeira resposta
* conversas por status
* tarefas vencidas
* alertas ativos
* volume por período
* handoffs por período
* taxa inicial bot vs humano, se os dados permitirem

### Regras obrigatórias

* não inventar métrica sem base de dados
* documentar fórmula de cada KPI

---

## MÓDULO 8 — SECRETARY-ADAPTER

Implementar camada de integração com Agent Secretary.

### Escopo obrigatório

* adaptar contratos necessários
* controlar entrada/saída da Secretary
* registrar handoff
* registrar contexto mínimo de troca
* preservar compatibilidade máxima com fluxo existente

### Regras obrigatórias

* não espalhar lógica de Secretary pelo sistema inteiro
* adapter deve concentrar conversão de contratos e estados
* qualquer dependência de legado deve ficar delimitada

---

## MÓDULO 9 — CHATWOOT-COMPAT

Criar somente se necessário.

### Escopo permitido

* mapear labels
* mapear estados
* mapear payloads
* fornecer compatibilidade temporária

### Regras obrigatórias

* não transformar esse módulo em centro do sistema
* usar apenas como borda de compatibilidade

---

## BACKEND — REGRAS DE IMPLEMENTAÇÃO

Implementar `apps/desk-api` com separação clara entre:

* rotas
* controllers/handlers
* services/use-cases
* repositories
* schemas/validation
* adapters
* events
* auth
* audit hooks

### Regras obrigatórias

* validar entrada com schema real
* não usar `any` sem necessidade extrema
* evitar lógica de negócio em controller
* usar repository/service com fronteiras claras
* padronizar erros
* criar health endpoints
* criar logging consistente
* preparar ambiente para workers

---

## FRONTEND — REGRAS DE IMPLEMENTAÇÃO

Implementar `apps/desk-web` com estrutura administrativa clara.

### Telas mínimas obrigatórias

* login
* inbox
* detalhe da conversa
* tarefas
* alertas
* dashboard
* administração de usuários e filas
* auditoria básica

### Estrutura de layout obrigatória

Tela principal de inbox com 3 colunas:

1. lista de conversas
2. conversa atual
3. painel lateral contextual

### Painel lateral obrigatório

* dados do contato/tutor
* pacientes relacionados quando houver
* tarefas vinculadas
* notas internas
* alertas ativos
* resumo operacional

### Regras obrigatórias

* navegação limpa
* filtros reais
* estado de loading/erro decente
* interface preparada para uso operacional contínuo
* não criar UI bonita porém vazia de função

---

## MODELO DE DADOS — EXIGÊNCIA

Você deve criar o modelo inicial com migrations reais.

As tabelas mínimas esperadas incluem, no mínimo:

* users
* roles
* permissions
* user_roles
* queues
* teams
* contacts
* tutors
* patients
* conversations
* messages
* conversation_assignments
* conversation_tags
* tasks
* task_status_history
* internal_notes
* alerts
* alert_events
* audit_logs
* macros

Você deve definir:

* PKs
* FKs
* índices
* campos de auditoria
* campos de created_at / updated_at
* campos de status
* constraints coerentes

---

## REALTIME E EVENTOS — EXIGÊNCIA

Você deve implementar a fundação de realtime.

### O que precisa existir

* evento de nova mensagem
* evento de atualização de conversa
* evento de mudança de atribuição
* evento de tarefa/alerta relacionado quando impactar a UI

### Regras obrigatórias

* separar inbound de outbound
* tratar idempotência
* prever retry no processamento de eventos
* documentar event envelope usado internamente

---

## SEGURANÇA — EXIGÊNCIA

Implementar base de segurança mínima séria.

### Obrigatório

* autenticação interna
* autorização por papel/permissão
* validação de webhook
* segregação entre usuário interno e canal externo
* variáveis sensíveis por `.env`
* documentação de segredos e configuração

### Não permitido

* tokens hardcoded
* segredos no código
* bypass de auth “temporário” sem registro

---

## AUDITORIA E OBSERVABILIDADE — EXIGÊNCIA

### Você deve implementar

* logs estruturados
* audit trail
* error handling consistente
* health endpoint
* readiness/liveness quando aplicável
* documentação do que deve ser monitorado

### Registrar como mínimo

* inbound recebido
* outbound enviado
* falha de integração
* erro de worker
* falha de validação importante
* eventos administrativos relevantes

---

## ORDEM OBRIGATÓRIA DE EXECUÇÃO

Você deve executar nesta ordem.

# FASE 0 — FOUNDATION E DOCUMENTAÇÃO

## Objetivo

Criar a base documental e estrutural antes da implementação pesada.

## Entregas obrigatórias

* criar `/docs`
* escrever todos os arquivos base de documentação
* criar estrutura do monorepo/projeto
* configurar apps e packages iniciais
* configurar lint, tsconfig, env example, docker base
* registrar tudo no `/docs/20-master-execution-log.md`

## Critério de pronto

* documentação base criada
* estrutura de projeto pronta
* projeto sobe localmente com base mínima

---

# FASE 1 — AUTH, ADMIN FOUNDATION E DATABASE

## Objetivo

Preparar identidade, autorização, banco e fundações transversais.

## Entregas obrigatórias

* módulo auth
* RBAC inicial
* migrations iniciais
* entidades base
* users, roles, permissions, queues, teams
* seed mínimo inicial
* health endpoints

## Critério de pronto

* login funcional
* banco sobe
* migrations executam
* usuários e permissões existem
* admin foundation pronta

---

# FASE 2 — CHAT CORE

## Objetivo

Construir núcleo de conversas.

## Entregas obrigatórias

* conversations
* messages
* assignments
* tags
* APIs de listagem e detalhe
* UI de inbox
* UI de detalhe da conversa
* ingestão inicial dos eventos do gateway
* envio de mensagem
* registro auditável

## Critério de pronto

* possível visualizar conversas
* possível abrir conversa
* possível registrar mensagens inbound/outbound
* possível atribuir responsável
* possível atualizar interface com realtime básico

---

# FASE 3 — TASKS, NOTES E ALERTS

## Objetivo

Adicionar operação interna real.

## Entregas obrigatórias

* módulo tasks funcional
* módulo notes funcional
* módulo alerts funcional
* painel lateral contextual no frontend
* vínculo entre conversa e operação interna

## Critério de pronto

* possível criar tarefa a partir da conversa
* possível criar nota
* alertas aparecem e são gerenciáveis
* operação interna passa a existir no sistema

---

# FASE 4 — SECRETARY ADAPTER E COMPATIBILIDADE

## Objetivo

Integrar de forma controlada com Secretary e legado.

## Entregas obrigatórias

* módulo secretary-adapter
* mapping de contratos necessários
* eventos de handoff
* compatibilidade mínima legada
* documentação clara do adapter

## Critério de pronto

* Secretary consegue interagir sem depender de reescrita ampla
* handoff fica registrado
* contratos ficam centralizados no adapter

---

# FASE 5 — DASHBOARD, AUDIT HARDENING E OBSERVABILIDADE

## Objetivo

Consolidar gestão e endurecimento operacional.

## Entregas obrigatórias

* dashboard inicial
* auditoria consultável
* métricas operacionais
* logs estruturados
* documentação de monitoramento
* hardening de fluxos principais

## Critério de pronto

* gestor consegue enxergar operação mínima
* trilha de auditoria está utilizável
* sistema está coerente para uso controlado inicial

---

## FORMA DE EXECUÇÃO OBRIGATÓRIA

Em cada fase, você deve:

1. atualizar `/docs/20-master-execution-log.md`
2. descrever exatamente o que criou
3. descrever exatamente o que alterou
4. justify decisões não triviais
5. registrar pendências reais
6. registrar riscos remanescentes
7. registrar como validar a fase

---

## PADRÃO DE ENTREGA EM CADA FASE

Para cada fase, você deve produzir:

### A. documentação atualizada

Arquivos `.md` relevantes atualizados

### B. código real

Sem pseudoimplementação

### C. validação

Comandos reais para subir, migrar, testar e validar

### D. checklist de pronto

Objetivo e verificável

---

## COMANDOS E AUTOMAÇÃO

Você deve criar no repositório scripts úteis, como por exemplo:

* bootstrap
* dev
* build
* lint
* test
* db:migrate
* db:seed
* worker:dev

Adapte os nomes ao padrão do projeto, mas forneça uma experiência operacional clara.

---

## REGRAS DE QUALIDADE DE CÓDIGO

### Obrigatório

* TypeScript estrito quando viável
* validação de input
* nomes claros
* módulos com responsabilidade real
* sem espalhar regra de negócio em múltiplos lugares
* sem duplicação evitável
* sem comentários inúteis
* sem código morto deliberado

### Não permitido

* “TODO” crítico sem registro em docs
* endpoints sem validação
* serviços com responsabilidade confusa
* acoplamento direto do frontend ao payload cru do gateway sem camada interna

---

## TESTES MÍNIMOS OBRIGATÓRIOS

Você deve implementar testes ao menos para:

* auth básico
* permissionamento básico
* criação/listagem de conversa
* ingestão inbound com idempotência
* criação de tarefa
* criação de nota
* geração ou lifecycle básico de alerta
* adapter principal da Secretary, se criado

Se o repositório tiver pouca base de testes, construir smoke tests e integration tests mínimos já é obrigatório.

---

## O QUE VOCÊ DEVE EVITAR

* não reescrever o gateway inteiro
* não reescrever a Secretary inteira
* não tentar resolver omnichannel completo agora
* não abrir módulo extra sem necessidade real
* não superengenheirar o sistema a ponto de travar a execução
* não entregar apenas documentação sem código
* não entregar apenas código sem documentação

---

## COMO TOMAR DECISÕES QUANDO HOUVER DÚVIDA

Se houver dúvida de implementação, siga esta prioridade:

1. preservar operação existente
2. reduzir acoplamento
3. centralizar compatibilidade em adapters
4. favorecer clareza estrutural
5. favorecer incremento funcional validável
6. evitar refator destrutivo precoce

---

## ENTREGÁVEL FINAL ESPERADO DO EXECUTOR

Ao concluir este trabalho, o repositório deve conter:

* documentação enterprise completa em `/docs`
* backend implementado por módulos
* frontend desk funcional
* banco e migrations
* autenticação e RBAC
* chat core
* tasks
* notes
* alerts
* admin foundation
* audit foundation
* dashboard inicial
* integration adapters necessários
* scripts operacionais
* validação mínima executável

---

## INSTRUÇÃO FINAL DE EXECUÇÃO

Não responda com análise vaga.
Não responda pedindo redefinição do escopo.
Não responda com proposta superficial.

Execute a construção do sistema de forma incremental, documentada e validável.

Sempre que concluir uma fase:

* atualize `/docs/20-master-execution-log.md`
* marque claramente o que foi feito
* registre o que ficou pendente
* explique como validar
* só então avance para a próxima fase

Comece imediatamente pela **FASE 0 — FOUNDATION E DOCUMENTAÇÃO**, criando a estrutura documental e estrutural completa do projeto.
