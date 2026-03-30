# Visão do Produto — CVG Connect Desk

## 1. Declaração do Produto
O **CVG Connect Desk** é a camada operacional do atendimento digital e da coordenação interna do hospital veterinário. Seu papel é organizar conversas, atribuições, tarefas, notas, alertas e visibilidade gerencial sobre a operação que já acontece no canal existente.

O produto opera **sobre a infraestrutura atual**, preservando:
- **Gateway existente** como ponto de entrada e saída das mensagens.
- **Evolution API** como tecnologia já utilizada na camada de mensageria.
- **Agent Secretary** como serviço responsável pela automação e triagem conversacional.

Nesta fase, o Desk não redefine a arquitetura legada. Ele adiciona controle operacional, rastreabilidade e contexto de trabalho para o time humano.

## 2. O Que o Sistema É
- Uma **camada operacional** para atendimento humano e coordenação interna.
- Um **workspace de execução** para inbox, atribuição, acompanhamento e resolução de pendências.
- Uma **fonte interna de contexto operacional** para tarefas, notas e alertas ligados à conversa e ao trabalho do time.
- Uma **camada de integração** com o gateway e com a Secretary, sem substituir a responsabilidade desses componentes.
- Uma **base de observação gerencial inicial**, com dashboard operacional e trilha auditável nas próximas fases do produto.

## 3. O Que o Sistema Não É
- Não é um **CRM completo** nesta fase.
- Não é um **HIS** nem um prontuário clínico completo.
- Não é uma **plataforma omnichannel completa**.
- Não é um substituto do **gateway**.
- Não é um substituto da **Agent Secretary**.
- Não é uma reimplementação da **Evolution API**.
- Não é um produto financeiro, de billing ou automação de marketing.

## 4. Problema Operacional
Hoje o hospital opera atendimento digital com forte dependência de WhatsApp, gateway já em produção, Secretary para triagem e uma interface humana genérica. O fluxo existe, mas o trabalho operacional fica fragmentado.

Na prática, isso gera problemas recorrentes:
- Conversas humanas sem contexto operacional suficiente para decisão rápida.
- Handoffs entre bot, recepção e equipe clínica com baixa rastreabilidade.
- Tarefas e pendências controladas fora do fluxo principal de atendimento.
- Notas internas dispersas ou informais.
- Falta de alertas operacionais explícitos para risco de atraso, abandono ou exceção.
- Baixa visibilidade consolidada para gestão sobre fila, resposta e gargalos.

O Desk resolve esse problema ao centralizar a execução operacional em uma única camada própria do hospital, sem exigir reescrita da infraestrutura de mensageria já existente.

## 5. Responsabilidade do Sistema
O Desk é responsável por:
- oferecer inbox operacional para atendimento humano;
- registrar mensagens e status relevantes da conversa no contexto interno do Desk;
- permitir atribuição de conversas para usuários e filas;
- organizar tarefas, notas e alertas relacionados ao atendimento;
- oferecer administração básica de usuários, papéis, filas e times;
- expor dashboard operacional inicial com métricas fundamentais;
- manter compatibilidade com integrações já existentes por meio do gateway e do adapter da Secretary.

O Desk não é responsável por:
- transportar mensagens diretamente no lugar do gateway;
- decidir a lógica interna da Secretary;
- manter prontuário clínico completo;
- consolidar financeiro, cobrança, faturamento ou marketing;
- suportar todos os canais de comunicação nesta fase.

## 6. Escopo Atual (MVP Real)
O MVP real do CVG Connect Desk é limitado aos seguintes blocos:

### 6.1 Chat
- Inbox operacional.
- Listagem de conversas.
- Mensagens inbound e outbound no contexto do Desk.
- Status de conversa.
- Atribuição e handoff entre responsáveis humanos.

### 6.2 Tasks
- Criação, atribuição e acompanhamento de tarefas operacionais.
- Vinculação de tarefa a conversa ou contexto operacional relacionado.

### 6.3 Notes
- Registro de notas internas.
- Vinculação de notas ao contexto operacional pertinente.

### 6.4 Alerts
- Alertas operacionais manuais ou automáticos baseados em eventos do sistema.
- Ciclo mínimo de reconhecimento e resolução.

### 6.5 Admin Básico
- Usuários.
- Papéis e permissões.
- Filas.
- Times.

### 6.6 Dashboard Inicial
- Indicadores operacionais básicos de atendimento, backlog e alertas.

### 6.7 Integração com Gateway e Secretary
- Consumo dos eventos necessários vindos da infraestrutura existente.
- Emissão dos eventos e chamadas necessárias para preservar o fluxo com a Secretary.
- Compatibilidade controlada com contratos legados quando estritamente necessário.

## 7. Fora de Escopo
Os itens abaixo não fazem parte desta fase e não devem ser inferidos como entregáveis implícitos:
- CRM completo.
- Financeiro.
- Billing.
- Automação de marketing.
- Omnichannel completo.
- Mobile app.
- BI avançado.
- Reescrita do gateway.
- Reescrita da Secretary.
- Reescrita da Evolution API.
- Prontuário clínico completo.
- ERP hospitalar.

## 8. Papéis de Usuário e Responsabilidades
Os perfis abaixo representam responsabilidades de negócio. A implementação técnica deve respeitar RBAC e permissões granulares.

### 8.1 Atendente
Pode:
- operar inbox e responder conversas dentro das permissões concedidas;
- assumir, transferir e atualizar status de conversas;
- criar tarefas, notas e sinalizações operacionais conforme política interna;
- registrar informações necessárias para continuidade do atendimento.

Não pode:
- administrar usuários, papéis ou parâmetros globais do sistema;
- alterar contratos de integração;
- acessar funções administrativas fora do seu escopo;
- assumir capacidade clínica ou gerencial que não lhe foi atribuída.

### 8.2 Equipe Clínica
Pode:
- consultar o contexto operacional necessário para continuidade assistencial;
- receber, atualizar e concluir tarefas sob sua responsabilidade;
- registrar notas internas e interações operacionais relacionadas ao caso;
- acompanhar alertas e pendências vinculadas ao seu trabalho.

Não pode:
- operar administração global do sistema;
- redefinir filas, papéis ou permissões;
- alterar integrações de mensageria ou automação;
- usar o sistema como prontuário clínico completo.

### 8.3 Gestor
Pode:
- acompanhar dashboard operacional e indicadores de fluxo;
- supervisionar filas, handoffs, backlog e alertas;
- consultar histórico operacional e trilhas de acompanhamento permitidas;
- atuar sobre priorização operacional dentro das permissões definidas.

Não pode:
- modificar infraestrutura de gateway, Evolution ou Secretary pelo Desk;
- usar o sistema como suíte completa de BI corporativo;
- substituir funções administrativas técnicas reservadas ao administrador.

### 8.4 Administrador
Pode:
- gerenciar usuários, papéis, permissões, filas e times;
- manter configuração operacional básica do Desk;
- supervisionar acesso, governança e continuidade operacional do sistema;
- apoiar a preservação dos contratos necessários para integração.

Não pode:
- redefinir unilateralmente contratos externos sem alinhamento arquitetural;
- tratar o Desk como substituto do gateway ou da Secretary;
- ampliar escopo funcional sem decisão explícita de produto e arquitetura.

## 9. Compatibilidade com os Próximos Módulos
Esta visão do produto deve orientar a execução dos módulos previstos sem abrir escopo indevido:
- **Chat** como núcleo operacional de conversas e atribuições.
- **Tasks**, **Notes** e **Alerts** como extensões operacionais do atendimento.
- **Admin** como base de acesso e parametrização mínima.
- **Dashboard** como leitura gerencial inicial, não como BI avançado.
- **Audit** como capacidade transversal de rastreabilidade, suporte a governança e histórico de ações, sem transformar o produto em plataforma de compliance independente.

## 10. Presente x Futuro
### Presente
O compromisso desta fase é entregar um Desk operacional utilizável, acoplado à infraestrutura existente e focado no fluxo real do hospital.

### Futuro Possível, Não Contratado Nesta Fase
Podem existir evoluções futuras, desde que formalmente aprovadas e documentadas depois:
- expansão de contexto de relacionamento;
- maior sofisticação analítica;
- novos canais;
- aprofundamento de integrações clínicas e comerciais.

Nenhuma dessas evoluções deve ser assumida como requisito do MVP atual.

## 11. Diretriz de Execução
Qualquer implementação derivada deste documento deve respeitar as seguintes restrições:
- não criar dependência de reescrita do gateway;
- não criar dependência de reescrita da Secretary;
- não presumir omnichannel completo;
- não presumir CRM completo;
- não deslocar o Desk para responsabilidades de HIS;
- não inventar comportamento ausente nos contratos existentes.

O objetivo do produto nesta fase é simples: **dar controle operacional ao hospital sobre o atendimento e o trabalho interno, usando a infraestrutura que já existe**.
