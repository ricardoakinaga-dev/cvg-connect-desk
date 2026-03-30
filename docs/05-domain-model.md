# Modelo de Domínios — CVG Connect Desk

## 1. Objetivo
Este documento define os domínios do sistema, seus limites, responsabilidades, agregados principais e relações permitidas.

A modelagem deve priorizar:
- separação clara de responsabilidade;
- baixo acoplamento entre domínios;
- integridade transacional local;
- comunicação entre domínios por eventos, referências e services de aplicação explícitos;
- preservação de compatibilidade com integrações externas.

## 2. Estado Atual do Repositório e Leitura Correta deste Documento
No estado atual do repositório:
- a implementação concreta em banco já cobre IAM, Chat Core e Operations em `packages/database/src/schema.ts` e nas migrations já geradas;
- `modules/chat`, `modules/tasks`, `modules/notes` e `modules/alerts` já possuem recortes iniciais de repositories, use cases e controllers;
- `admin`, `audit`, `dashboard`, `secretary-adapter`, `chatwoot-compat`, worker e realtime continuam majoritariamente em nível arquitetural e documental.

Portanto, este documento continua descrevendo a **modelagem alvo obrigatória** para as próximas fases. Ele não deve ser interpretado como afirmação de que todos os agregados, entidades e fronteiras aqui descritos já estejam completamente materializados no runtime atual.

## 3. Princípios de Modelagem

### 3.1 Limite Transacional
Cada domínio deve preservar seu próprio limite transacional.

Não é permitido usar transações distribuídas entre múltiplos domínios como regra padrão da solução.

### 3.2 Comunicação Entre Domínios
A comunicação entre domínios deve ocorrer preferencialmente por:
- eventos internos;
- referências por identificador;
- services de aplicação explicitamente definidos.

### 3.3 Baixo Acoplamento
Nenhum domínio deve depender diretamente de detalhes internos de Gateway, Evolution API, Chatwoot ou Secretary.

### 3.4 Contexto Operacional, Não Soberania Clínica
O sistema mantém contexto operacional suficiente para atendimento, priorização e rastreabilidade, mas não substitui o HIS nem o prontuário clínico completo.

## 4. Chat Domain

### 4.1 Responsabilidade
Gerenciar a vida operacional da conversa digital.

### 4.2 Aggregate Root
- `Conversation`

### 4.3 Entidades Principais
- `Conversation`
- `Message`
- `Participant`
- `ConversationAssignment`
- `ConversationTag`
- `Attachment`
- `ConversationStatusHistory`

### 4.4 Responsabilidades do Domínio
- criar e manter conversas;
- persistir mensagens inbound e outbound;
- manter status operacional da conversa;
- manter responsável atual;
- manter tags aplicadas;
- manter histórico de mudanças relevantes da conversa.

### 4.5 Regras de Modelagem
- `Conversation` é a raiz do agregado;
- `Message` pertence a uma `Conversation`;
- mensagens persistidas devem ser tratadas como registros operacionais essencialmente imutáveis, exceto por metadados operacionais explicitamente permitidos;
- `ConversationAssignment` deve permitir rastrear estado atual e histórico;
- o modelo deve distinguir claramente o responsável atual da conversa do histórico de atribuições anteriores;
- `Attachment` pertence ao contexto de mensagem;
- referências externas de canal devem ser armazenadas sem contaminar o modelo interno;
- deduplicação de inbound e rastreabilidade de outbound pertencem ao fluxo do Chat Domain em conjunto com a camada de adapters, sem transformar o domínio em dono do Gateway.

### 4.6 Relações Externas Permitidas
A conversa pode referenciar:
- `Contact`;
- `Tutor`;
- `Patient`;
- identificadores externos de canal.

Essas referências não tornam o Chat Domain dono desses domínios.

## 5. Tasks Domain

### 5.1 Responsabilidade
Gerenciar trabalho operacional delegável derivado do atendimento.

### 5.2 Aggregate Root
- `Task`

### 5.3 Entidades Principais
- `Task`
- `TaskStatusHistory`
- `TaskComment` apenas se for adotado explicitamente nesta fase

### 5.4 Responsabilidades do Domínio
- criar tarefa;
- atribuir responsável;
- definir prioridade;
- definir prazo;
- controlar mudança de status;
- manter histórico mínimo de evolução.

### 5.5 Relações Externas Permitidas
Uma `Task` pode referenciar:
- `Conversation`;
- `Tutor`;
- `Patient`.

A task não deve incorporar dados completos desses domínios.

## 6. Notes Domain

### 6.1 Responsabilidade
Registrar observações internas operacionais.

### 6.2 Aggregate Root
- `InternalNote`

### 6.3 Entidades Principais
- `InternalNote`

### 6.4 Responsabilidades do Domínio
- criar nota interna;
- vincular nota a um contexto permitido;
- preservar autoria e timestamp;
- permitir leitura contextual por entidade relacionada.

### 6.5 Regras de Modelagem
- nota interna não se confunde com mensagem;
- a nota deve possuir `reference_type` e `reference_id`;
- o modelo deve permitir vínculo com:
  - `Conversation`;
  - `Tutor`;
  - `Patient`;
  - `Task`.

### 6.6 Regra de Integridade
A nota deve ser tratada como registro operacional interno e auditável.

## 7. Alerts Domain

### 7.1 Responsabilidade
Gerenciar alertas operacionais que exigem atenção humana.

### 7.2 Aggregate Root
- `Alert`

### 7.3 Entidades Principais
- `Alert`
- `AlertEvent`

### 7.4 Responsabilidades do Domínio
- abrir alerta;
- classificar severidade;
- reconhecer alerta;
- resolver alerta;
- manter lifecycle histórico.

### 7.5 Lifecycle Mínimo
- `pending`
- `acknowledged`
- `resolved`

### 7.6 Regra de Integridade do Lifecycle
O encerramento ou resolução de um alerta deve preservar o histórico de lifecycle.

O registro operacional do alerta não deve ser removido de forma destrutiva como mecanismo padrão de resolução.

### 7.7 Relações Externas Permitidas
Um `Alert` pode referenciar:
- `Conversation`;
- `Task`;
- `Patient`;
- integração ou erro operacional.

## 8. Contact / Operational Context Domain

### 8.1 Responsabilidade
Fornecer contexto operacional mínimo sobre contato, tutor e paciente para suportar o atendimento.

### 8.2 Aggregate Roots
- `Contact`
- `Tutor`
- `Patient`

### 8.3 Responsabilidades do Domínio
- manter identificação operacional básica;
- relacionar tutor e paciente;
- permitir vínculo da conversa com contexto real;
- suportar identificadores externos para integração futura;
- evitar dependência do atendimento em dados clínicos ricos locais.

### 8.4 Regra Crítica
Este domínio não substitui o HIS e não é o prontuário clínico completo.

### 8.5 Modelagem Recomendada
- dados mínimos locais para operação;
- suporte a identificadores externos para integração futura;
- evitar duplicação excessiva de dados clínicos;
- não assumir soberania sobre cadastro mestre clínico ou financeiro.

## 9. IAM Domain

### 9.1 Responsabilidade
Controlar identidade e autorização dos usuários internos do Desk.

### 9.2 Aggregate Roots
- `User`
- `Role`
- `Queue`
- `Team`

### 9.3 Entidades Principais
- `User`
- `Role`
- `Permission`
- `UserRole`
- `RolePermission`
- `Queue`
- `Team`

### 9.4 Responsabilidades do Domínio
- autenticação de usuários internos;
- autorização por papel e permissão;
- vínculo com filas e times;
- separação clara de acesso por contexto operacional.

### 9.5 Observação de Implementação Atual
Este é o único domínio com modelagem de banco já iniciada no repositório atual.

## 10. Audit Domain

### 10.1 Responsabilidade
Registrar rastreabilidade cronológica das ações relevantes do sistema.

### 10.2 Aggregate Root
- `AuditLog`

### 10.3 Entidades Principais
- `AuditLog`

### 10.4 Responsabilidades do Domínio
- registrar ator;
- registrar ação;
- registrar entidade afetada;
- registrar timestamp;
- registrar metadados relevantes;
- permitir consulta posterior.

### 10.5 Regra Crítica
Audit é domínio transversal de rastreabilidade.

Ele não deve carregar regra principal de negócio.

## 11. Dashboard / Metrics Domain

### 11.1 Responsabilidade
Expor métricas derivadas da operação.

### 11.2 Entidades Principais
- `MetricSnapshot` ou projeções equivalentes, se adotadas;
- visões derivadas do banco operacional;
- contadores e projeções consumidos pelo dashboard.

### 11.3 Regra Crítica
Dashboard não é fonte primária de verdade.

Ele consome dados operacionais consolidados.

## 12. Relações Entre Domínios

### 12.1 Relações Permitidas por Referência
- `Conversation` → `Contact`
- `Conversation` → `Tutor`
- `Conversation` → `Patient`
- `Task` → `Conversation`
- `Task` → `Tutor`
- `Task` → `Patient`
- `InternalNote` → entidade referenciada por `reference_type/reference_id`
- `Alert` → `Conversation`
- `Alert` → `Task`
- `Alert` → `Patient`

### 12.2 Regra de Acoplamento
Domínios devem trocar contexto por identificadores e eventos.

Não devem incorporar modelos internos uns dos outros de forma rica.

## 13. Eventos de Domínio em Nível Conceitual
Exemplos:
- `conversation.created`
- `message.inbound.received`
- `message.persisted`
- `conversation.assigned`
- `task.created`
- `task.overdue`
- `note.created`
- `alert.created`
- `alert.acknowledged`
- `alert.resolved`

A definição técnica detalhada desses eventos pertence ao documento de realtime e eventos.

## 14. Regras de Implementação
Antes de modelar entidades, rotas ou tabelas, é obrigatório:
- verificar se já existe modelagem equivalente;
- verificar se já existe rota ou handler relacionado;
- verificar se a integração correspondente já existe;
- evitar criar entidade sem aggregate root claro;
- evitar criar relacionamento rico entre domínios que deveriam se referenciar apenas por ID.

Se houver divergência entre o modelo desejado e o estado real do sistema:
- adaptar a implementação à arquitetura preservada;
- evitar duplicação de responsabilidade;
- atualizar este documento explicitamente antes de consolidar nova modelagem.

## 15. Regra de Precedência
Este documento orienta:
- modelagem de banco;
- estrutura de módulos;
- contratos de domínio;
- validações de fronteira entre módulos.

Se houver conflito entre implementação e este documento, a modelagem deve ser corrigida ou este arquivo deve ser atualizado explicitamente antes de prosseguir.
