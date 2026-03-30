# Contexto de Negócio — CVG Connect Desk

## 1. Contexto Operacional do Hospital
O hospital veterinário opera o atendimento digital com dois elementos centrais:
- **Tutor**: responsável financeiro e principal interlocutor no canal.
- **Paciente**: animal atendido pelo hospital.

O canal predominante da operação é o **WhatsApp**. Isso significa que boa parte da rotina comercial, clínica e emergencial do hospital depende de mensagens assíncronas, triagem rápida, priorização correta e handoff eficiente entre automação e equipe humana.

## 2. Classificação Operacional das Interações
O sistema precisa tratar as interações como categorias operacionais utilizáveis pela operação, não apenas como texto livre.

### 2.1 Clínico
Abrange interações como:
- atualizações de internação;
- resultados de exames;
- orientações médicas;
- comunicações sensíveis sobre estado do paciente.

### 2.2 Comercial
Abrange interações como:
- orçamentos;
- agendamentos;
- vacinas;
- pacotes e serviços.

### 2.3 Urgente
Abrange interações como:
- triagem emergencial;
- pacientes críticos;
- situações com risco clínico imediato.

### 2.4 Uso da Classificação pelo Sistema
Essa classificação deve ser utilizável por:
- prioridade operacional;
- filas;
- regras de handoff;
- alertas;
- leitura gerencial no dashboard.

Ela não substitui julgamento clínico. Sua função nesta fase é operacionalizar o fluxo do atendimento.

## 3. Fluxo Tecnológico
Para evitar ambiguidade, este documento separa o **fluxo legado atual** do **fluxo operacional de referência do projeto**.

### 3.1 Fluxo Legado Atual
O atendimento hoje parte da infraestrutura já existente:

```text
WhatsApp
-> Evolution API
-> Gateway
-> Chatwoot + Agent Secretary
-> resposta ao tutor
```

Esse é o ponto de partida real da operação.

### 3.2 Fluxo Operacional de Referência do Connect Desk
No escopo desta iniciativa, o fluxo operacional de referência passa a ser:

```text
WhatsApp
-> Evolution API
-> Gateway
-> Connect Desk
-> Secretary
-> resposta ao tutor
```

Interpretação correta desse fluxo:
- o **Gateway** continua sendo a camada de integração e roteamento;
- o **Connect Desk** passa a ser a camada operacional principal;
- a **Secretary** continua sendo a camada de automação e triagem quando aplicável;
- a resposta ao tutor continua saindo pela infraestrutura já existente, sem reescrita de canal.

O objetivo não é alterar canal, gateway ou IA. O objetivo é colocar a operação sob controle do Desk.

## 4. Responsabilidade de Cada Sistema
As responsabilidades abaixo são separadas para evitar sobreposição entre componentes.

### 4.1 Evolution API
Responsável por:
- conexão com o WhatsApp;
- envio e recebimento de mensagens no canal.

Não é responsável por:
- regras operacionais do hospital;
- gestão de tarefas, alertas ou notas;
- governança do atendimento humano.

### 4.2 Gateway
Responsável por:
- receber eventos do canal;
- normalizar payload;
- encaminhar mensagens;
- controlar envio e roteamento entre sistemas integrados.

Não é responsável por:
- operar a inbox hospitalar;
- executar a lógica operacional do Desk;
- substituir a Secretary;
- gerenciar tarefas, notas, filas ou dashboard.

### 4.3 Secretary
Responsável por:
- triagem inicial;
- classificação de intenção;
- automação de respostas;
- decisão de handoff para atendimento humano quando aplicável.

Não é responsável por:
- operar a interface humana de atendimento;
- centralizar rastreabilidade operacional do hospital;
- substituir a camada operacional do Desk.

### 4.4 Connect Desk
Responsável por:
- organizar conversas no contexto operacional do hospital;
- sustentar a inbox e o fluxo humano de atendimento;
- controlar status, responsável, fila e handoff;
- registrar tarefas, notas e alertas;
- consolidar rastreabilidade operacional;
- oferecer dashboard operacional inicial.

Não é responsável por:
- substituir Evolution API;
- substituir o Gateway;
- substituir a Secretary;
- entregar CRM completo;
- entregar HIS ou prontuário clínico completo;
- reimplementar omnichannel nesta fase.

## 5. Problema Operacional Real
O modelo atual atende o canal, mas não resolve de forma suficiente a operação hospitalar.

### 5.1 O Que Não Funciona Hoje
- A interface humana atual é genérica para o contexto do hospital.
- O vínculo operacional entre tutor e paciente não aparece de forma adequada no fluxo.
- O atendimento humano trabalha sem uma camada nativa de coordenação operacional.

### 5.2 Por Que Chatwoot Não Resolve
- Chatwoot resolve visualização e resposta genérica de conversa.
- Chatwoot não foi concebido como camada operacional de hospital veterinário.
- Chatwoot não cobre, como núcleo do produto, tarefas operacionais, pendências internas, alertas aderentes ao risco e rastreabilidade completa do trabalho.

### 5.3 Onde Estão os Gargalos
- priorização inconsistente entre conversa clínica, comercial e urgente;
- handoff entre bot e humano com baixa rastreabilidade;
- pendências controladas fora do fluxo principal;
- ausência de alertas operacionais claros para atraso, risco ou exceção;
- baixa visibilidade gerencial sobre tempo, fila, backlog e uso da Secretary.

## 6. Papel do Connect Desk
O **CVG Connect Desk** é a camada operacional própria do hospital sobre a infraestrutura já existente.

Ele existe para centralizar o trabalho que hoje fica fragmentado entre interface genérica, operação paralela e baixa visibilidade. Nesta fase, o Desk não muda a responsabilidade dos sistemas externos. Ele organiza a operação interna do hospital em torno do atendimento.

## 7. Conexão com os Módulos do MVP
O contexto de negócio descrito aqui deve orientar diretamente os módulos previstos nesta fase.

### 7.1 Chat
- inbox operacional;
- organização de conversas;
- status;
- atribuição;
- handoff.

### 7.2 Tasks
- criação e acompanhamento de pendências operacionais derivadas do atendimento.

### 7.3 Notes
- registro de contexto interno relevante para continuidade operacional.

### 7.4 Alerts
- sinalização de risco, atraso, exceção e prioridade operacional.

### 7.5 Dashboard
- visibilidade inicial sobre tempos, filas, gargalos, backlog e handoffs.

## 8. O Que Não Muda
Nesta fase:
- o **WhatsApp** continua sendo o principal canal;
- a **Evolution API** continua sendo a tecnologia de conexão com o canal;
- o **Gateway** continua como camada de integração;
- a **Secretary** continua como camada de automação e triagem;
- o Desk não assume escopo de CRM completo nem de HIS.

## 9. Impacto Estratégico
O Connect Desk permite:
- controle operacional próprio do hospital;
- menor dependência de interface genérica para o atendimento humano;
- melhor coordenação entre automação e operação humana;
- visibilidade real sobre desempenho operacional.

O ganho estratégico desta fase é operacional e gerencial. Não é a entrega de uma plataforma completa de CRM, BI avançado ou prontuário clínico.

## 10. Diretriz para as Próximas Fases
Qualquer implementação derivada deste contexto deve preservar os seguintes limites:
- não reescrever Gateway;
- não reescrever Secretary;
- não alterar contratos externos sem necessidade arquitetural explícita;
- não inferir funcionalidades fora do MVP;
- não deslocar o Desk para responsabilidades de HIS ou CRM completo.
