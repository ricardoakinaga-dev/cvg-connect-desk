# Escopo e Não-Escopo — CVG Connect Desk

## 1. Definição do Escopo
Este documento define de forma **restritiva e obrigatória** o que será implementado na fase atual do CVG Connect Desk.

Qualquer funcionalidade fora deste escopo deve ser considerada **proibida**, salvo alteração explícita da documentação oficial do projeto.

No estado atual do repositório, já existem rotas, handlers, repositories e use cases iniciais materializando parte do escopo de `chat`, `tasks`, `notes` e `alerts` em `apps/` e `modules/`. Ainda assim, este documento continua sendo o limite formal do que pode ou não pode ser implementado nas próximas fases e deve permanecer compatível com a arquitetura já definida para Gateway, Secretary e Evolution API.

## 2. In-Scope (Implementação Obrigatória)

### 2.1 Chat Core
Escopo permitido:
- inbox de conversas;
- visualização de mensagens;
- envio de mensagens via gateway;
- ingestão de mensagens inbound;
- atribuição de responsável;
- status da conversa;
- aplicação de tags;
- suporte a eventos vindos do gateway;
- suporte a handoff bot ↔ humano via Secretary.

Escopo não incluído dentro do chat:
- automação complexa;
- lógica clínica;
- CRM completo;
- campanhas;
- múltiplos canais.

### 2.2 Tasks
Escopo permitido:
- criação de tarefa a partir de conversa;
- atribuição de responsável;
- definição de prazo;
- prioridade;
- mudança de status;
- vínculo com conversa.

Escopo não incluído:
- workflow complexo;
- dependência entre tarefas;
- automação avançada.

### 2.3 Notes
Escopo permitido:
- criação de nota interna;
- vínculo com conversa;
- vínculo com tutor;
- vínculo com paciente;
- registro de autor e timestamp.

Escopo não incluído:
- edição colaborativa complexa;
- versionamento avançado.

### 2.4 Alerts
Escopo permitido:
- geração de alertas simples baseados em eventos;
- severidade;
- reconhecimento (`ack`);
- resolução.

Tipos mínimos obrigatórios:
- conversa sem resposta;
- tarefa vencida;
- conversa sem responsável.

Escopo não incluído:
- engine complexa de regras;
- machine learning;
- priorização automática avançada.

### 2.5 Dashboard
Escopo permitido:
- número de conversas abertas;
- tempo médio de resposta;
- tarefas vencidas;
- alertas ativos.

Escopo não incluído:
- BI avançado;
- relatórios customizáveis;
- análises complexas.

### 2.6 Audit Logs
Escopo permitido:
- registro de envio de mensagem;
- registro de mudança de status;
- registro de atribuição;
- registro de criação de tarefa;
- registro de criação de nota;
- registro de eventos administrativos relevantes;
- registro de reconhecimento e resolução de alerta.

Escopo não incluído:
- análise automática de logs;
- correlação avançada;
- plataforma de observabilidade independente do Desk.

### 2.7 Secretary Adapter
Escopo permitido:
- adaptação dos contratos necessários;
- tradução de eventos;
- registro de handoff;
- centralização de compatibilidade da Secretary em um único módulo.

Regras obrigatórias:
- não espalhar lógica da Secretary pelo sistema;
- o adapter deve ser o único ponto de integração com a Secretary dentro do Desk.

Escopo não incluído:
- reescrita da Secretary;
- alteração do comportamento da IA.

### 2.8 Admin Básico
Escopo permitido:
- gestão de usuários;
- gestão de papéis e permissões;
- gestão de filas;
- gestão de times.

Escopo não incluído:
- IAM corporativo completo;
- provisionamento avançado;
- administração multiempresa;
- suíte administrativa além da operação do Desk.

## 3. Out-of-Scope (Proibido Nesta Fase)
É explicitamente proibido implementar os itens abaixo nesta fase.

### 3.1 Infraestrutura
- reescrever o gateway;
- alterar comportamento da Evolution API;
- alterar contratos da Secretary;
- criar transporte paralelo de mensagens fora da infraestrutura prevista.

### 3.2 Produto
- CRM completo, incluindo financeiro, billing e funil avançado;
- HIS completo;
- prontuário clínico;
- automação de marketing;
- campanhas;
- omnichannel completo;
- aplicativo mobile;
- BI avançado;
- relatórios analíticos complexos.

### 3.3 Arquitetura
- refatoração destrutiva do sistema atual;
- substituição total do Chatwoot antes de estabilidade operacional do Desk;
- criação de serviços paralelos duplicando responsabilidade existente;
- espalhamento da lógica de integração da Secretary fora do adapter;
- qualquer ampliação do Desk para responsabilidades de canal, IA ou HIS.

## 4. Regras de Execução do Escopo

### 4.1 Antes de Criar Qualquer Funcionalidade
É obrigatório:
- verificar se já existe rota equivalente;
- verificar se já existe integração ativa;
- verificar se já existe contrato similar;
- verificar se já existe responsabilidade atribuída a outro módulo ou sistema.

Se existir:
- reutilizar;
- adaptar;
- não duplicar.

### 4.2 É Proibido
- criar rota sem uso real;
- criar endpoint não integrado;
- duplicar responsabilidade de outro serviço;
- alterar contrato sem atualizar a documentação correspondente;
- criar comportamento fora do escopo apenas porque a arquitetura futura pode suportá-lo.

### 4.3 Integrações
- Gateway é a fonte única de mensagens para integração do Desk.
- Secretary é a fonte única de IA e handoff automatizado.
- Connect Desk não substitui Gateway, Secretary ou Evolution API.

### 4.4 Limite de Implementação
Se houver divergência entre ideia de produto e sistema existente:
- o documento e a implementação devem se adaptar à arquitetura preservada;
- não deve haver quebra de integração;
- não deve haver duplicação de responsabilidade.

## 5. Critério de Conformidade
Uma implementação só é considerada válida se:
- respeita este escopo;
- não introduz funcionalidades fora da fase;
- não quebra integração existente;
- não cria duplicação de responsabilidade;
- mantém compatibilidade com Gateway e Secretary;
- preserva o papel do Secretary Adapter como ponto único de integração;
- mantém coerência com `chat`, `tasks`, `notes`, `alerts`, `admin`, `audit` e `dashboard`.

## 6. Resultado Esperado
Ao final desta fase, o sistema deve:
- operar atendimento real;
- suportar operação interna básica;
- fornecer visibilidade inicial;
- manter integração intacta com os sistemas existentes;
- permanecer dentro do MVP definido, sem expansão indevida de escopo.
