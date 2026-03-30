# Frontend Architecture — CVG Connect Desk

## 1. Objetivo
Definir a arquitetura de frontend do **CVG Connect Desk** de forma executável, operacional e coerente com o backend.

Este documento estabelece:
- estrutura da aplicação web;
- organização de layout, rotas e módulos;
- regras de estado;
- regras de consumo de API e realtime;
- responsabilidades da interface;
- limites explícitos do frontend.

## 2. Estado Atual do Repositório
No estado atual do monorepo:
- `apps/desk-web` já possui implementação operacional completa;
- existem páginas operacionais: Inbox (3 colunas), Tasks, Alerts, Dashboard;
- existe client centralizado de API em `src/lib/api.ts` com contratos tipados;
- autenticação real implementada com integração ao backend de auth;
- estado de autenticação com Zustand e persistência de sessão;
- fallback por polling para conversas, tasks e alerts;
- realtime ainda não está conectado ao frontend;
- a arquitetura abaixo descreve o **estado atual** e o **alvo de evolução**.

Este documento deve ser lido como afirmação de que o frontend operacional já foi entregue com hardening de autenticação.

## 3. Princípios Obrigatórios

### 3.1 Frontend Não É Fonte da Verdade
O frontend nunca será fonte primária da verdade para:
- status da conversa;
- assignment;
- tags;
- tasks;
- notes;
- alerts;
- handoff;
- métricas.

A fonte da verdade é o backend do Connect Desk.

### 3.2 Frontend É Camada Operacional
A interface deve servir à operação real do hospital.

Isso significa que a UI deve priorizar:
- velocidade operacional;
- clareza de contexto;
- baixa fricção;
- rastreabilidade;
- atualização confiável.

Não é objetivo desta fase construir interface visualmente sofisticada sem utilidade operacional real.

### 3.3 Sem Regra de Negócio Central na UI
O frontend pode conter:
- regras de apresentação;
- formatação;
- validações básicas de formulário;
- controle de fluxo visual;
- permissões de exibição.

O frontend não pode conter:
- decisão central de handoff;
- cálculo autoritativo de SLA;
- lifecycle canônico de conversa, tasks ou alerts;
- interpretação de payload legado como verdade de domínio.

### 3.4 Consumo Apenas por Contratos Internos
O frontend deve consumir contratos internos do Connect Desk, não payload cru de Gateway, Evolution API, Secretary ou compatibilidade legada.

Qualquer normalização deve chegar resolvida pela API ou pelo realtime do Desk.

### 3.5 Acessibilidade Operacional Mínima
A interface deve preservar condições mínimas para uso operacional contínuo, incluindo:
- legibilidade adequada de textos e dados críticos;
- contraste suficiente entre fundo, texto e estados de alerta;
- foco navegável e perceptível para interação por teclado quando aplicável;
- estados visuais claros para loading, seleção, erro, prioridade e bloqueio de ação.

## 4. Aplicação Web Alvo

### 4.1 Aplicação Principal
`apps/desk-web`

Responsável por:
- autenticação de usuários internos;
- navegação principal do sistema;
- inbox operacional;
- detalhe da conversa;
- painel contextual;
- tasks;
- alerts;
- dashboard;
- administração;
- auditoria básica quando prevista na fase.

### 4.2 Limites da Aplicação
O frontend não é responsável por:
- persistir estado canônico do domínio;
- decidir handoff bot ↔ humano;
- inferir regras de negócio a partir de payload cru externo;
- substituir validações, permissões e auditoria do backend.

## 5. Áreas Principais da Aplicação
A interface deve ser organizada em áreas funcionais claras:
- **Inbox / Conversas**;
- **Tasks**;
- **Alerts**;
- **Dashboard**;
- **Administração**;
- **Autenticação**;
- **Auditoria**, quando incluída no escopo da fase.

## 6. Tela Principal Operacional: Inbox
A tela principal de operação deve seguir estrutura de **3 colunas**, salvo ajuste visual justificado sem perda de função.

### 6.1 Coluna 1 — Lista de Conversas
Deve permitir:
- busca;
- filtros;
- visualização de fila;
- visualização de responsável;
- status;
- prioridade quando aplicável;
- indicador de não lida ou pendência;
- ordenação operacional.

### 6.2 Coluna 2 — Conversa Ativa
Deve permitir:
- leitura do histórico;
- envio de mensagem;
- exibição de anexos quando aplicável;
- visualização de eventos operacionais relevantes;
- troca controlada entre estados permitidos;
- indicação de bot ou humano quando aplicável.

### 6.3 Coluna 3 — Painel Contextual
Deve exibir, quando disponível:
- dados do contato ou tutor;
- dados mínimos do paciente;
- tasks vinculadas;
- notes internas;
- alerts ativos;
- resumo operacional;
- metadados relevantes da conversa.

## 7. Demais Áreas Operacionais

### 7.1 Tasks
Deve permitir:
- listagem;
- filtros;
- status;
- prioridade;
- responsável;
- prazo;
- navegação para entidade relacionada.

### 7.2 Alerts
Deve permitir:
- listagem de alerts ativos;
- severidade;
- origem;
- acknowledgment;
- resolução;
- navegação para contexto relacionado.

### 7.3 Dashboard
Deve permitir visualizar apenas métricas já definidas e suportadas pelo backend, como:
- conversas abertas;
- tempo médio de resposta;
- tasks vencidas;
- alerts ativos;
- handoffs por período, quando disponível.

O frontend não deve inventar KPI nem compor métrica sem contrato explícito.

### 7.4 Administração
Deve permitir, conforme escopo da fase:
- usuários;
- roles e permissões;
- filas;
- times;
- configurações operacionais permitidas.

## 8. Organização de Código do Frontend
A estrutura física pode variar conforme o framework e o padrão final adotado, mas deve preservar responsabilidades semelhantes a:

```text
apps/desk-web/
  app/ or src/
    pages or routes/
    modules/
      inbox/
      conversations/
      tasks/
      alerts/
      dashboard/
      admin/
      auth/
    components/
      layout/
      shared/
      domain/
    lib/
      api/
      realtime/
      auth/
      permissions/
      utils/
    state/
      queries/
      mutations/
      ui/
```

### Regra
A estrutura física pode ser adaptada ao framework, mas não deve misturar:
- rotas ou páginas;
- módulos funcionais;
- componentes visuais;
- acesso a API;
- acesso a realtime;
- regras de permissão;
- estado de UI;
- mapeamento de contrato.

Páginas e rotas devem compor módulos, containers e componentes especializados.

Elas não devem concentrar lógica operacional extensa, acesso a dados espalhado ou orquestração rica de fluxos de domínio diretamente na camada de página.

## 9. Estado no Frontend

### 9.1 Estado Remoto
Deve representar dados vindos da API ou do realtime:
- conversas;
- mensagens;
- tasks;
- alerts;
- dashboard;
- usuários e filas quando aplicável.

### 9.2 Estado de UI
Deve conter apenas:
- filtros;
- busca;
- seleção de conversa;
- painel aberto ou fechado;
- paginação;
- ordenação;
- estados de modal, drawer e interação visual.

### 9.3 Regras Obrigatórias de Estado
- backend é a fonte da verdade do estado operacional;
- estado remoto e estado de UI não podem se confundir;
- cache e invalidação devem seguir estratégia previsível;
- optimistic update só pode existir quando for segura e claramente reconciliada;
- frontend não pode simular persistência que o backend não confirmou;
- realtime não pode gerar estado paralelo fora da estratégia de cache definida.

## 10. Consumo de API

### 10.1 Regras Obrigatórias
- toda chamada deve passar por camada centralizada de client ou API;
- componentes visuais não devem montar requests diretamente quando isso puder ser centralizado;
- contratos devem ser tipados;
- erros devem ser normalizados na borda de consumo;
- serialização, desserialização e adaptação de contrato não devem ficar espalhadas por múltiplos componentes.

### 10.2 Proibições
- consumir payload cru de integração externa;
- acoplar componente ao formato legado;
- espalhar `fetch` ou cliente HTTP sem padrão por múltiplos pontos da UI;
- documentar chamada para endpoint inexistente como se já estivesse disponível.

## 11. Realtime no Frontend

### 11.1 Papel do Realtime
Realtime deve atualizar a interface para refletir mudanças já aceitas pelo backend, como:
- nova mensagem;
- atualização de conversa;
- mudança de assignment;
- task relacionada atualizada;
- alert criado, acknowledged ou resolvido.

### 11.2 Regras Obrigatórias
- realtime complementa a API, não substitui a carga inicial;
- realtime deve operar como projeção do estado já aceito pelo backend;
- eventos realtime devem atualizar cache ou estado remoto de maneira controlada;
- frontend não deve interpretar evento realtime cru como regra de negócio;
- fallback para revalidação deve existir quando necessário;
- se realtime ainda não estiver implementado em determinada fase, a UI pode usar fallback temporário de revalidação ou polling controlado;
- esse fallback temporário não deve alterar o contrato principal, nem inventar estado paralelo fora da estratégia normal de cache e sincronização;
- integração realtime não deve ser descrita como pronta enquanto não existir no repositório.

## 12. Permissões e Acesso na UI

### 12.1 Papel da UI
A UI pode esconder ou desabilitar elementos conforme permissões do usuário.

### 12.2 Regra Crítica
Permissão real é garantida no backend.

O frontend apenas reflete a capacidade esperada de interação.

### 12.3 Proibição
Nunca confiar apenas na UI para autorização.

## 13. Componentização

### 13.1 Regras Obrigatórias
- componentes compartilhados devem ser realmente compartilháveis;
- componentes de domínio devem ficar próximos de seu contexto funcional;
- componentes grandes demais devem ser quebrados por responsabilidade;
- lógica de acesso a dados não deve ficar misturada com apresentação quando puder ser separada.

### 13.2 Componentes Esperados
Exemplos de grupos:
- layout shell;
- conversation list;
- conversation timeline;
- message composer;
- task panel;
- notes panel;
- alerts panel;
- dashboard cards;
- admin tables e forms.

## 14. Validação e Formulários

### 14.1 Regras Obrigatórias
- validação de formulário deve ser consistente;
- validação de frontend é complementar à validação de backend;
- mensagens de erro devem ser operacionais e compreensíveis;
- submissões devem impedir duplicação acidental quando necessário.

### 14.2 Proibição
O frontend não deve assumir que um dado é válido apenas porque passou em validação local.

## 15. Tratamento de Erros e Estados de Carga
A interface deve tratar explicitamente:
- loading inicial;
- loading incremental;
- erro de requisição;
- vazio operacional;
- reconexão ou revalidação quando aplicável.

Regra:
não esconder falhas críticas da operação sob UI silenciosa.

## 16. Auditoria e Rastreabilidade Visual
Quando previsto no escopo da fase, a interface deve conseguir exibir contexto suficiente para rastreabilidade, como:
- responsável atual;
- histórico relevante da conversa;
- origem de alert;
- timestamps operacionais;
- estado do handoff quando exposto.

A UI não é a fonte da auditoria, mas deve conseguir consumi-la de forma útil.

## 17. Regras de Implementação
Antes de criar ou alterar qualquer tela, fluxo ou integração no frontend, é obrigatório:
- verificar se já existe rota de API correspondente;
- verificar se já existe contrato tipado disponível;
- verificar se já existe componente ou módulo equivalente;
- verificar se o fluxo depende de integração ainda não implementada;
- impedir chamada para rota solta;
- impedir acoplamento a payload cru;
- impedir regra de negócio central em componente de UI.

Se a API ou contrato ainda não existir:
- não inventar comportamento definitivo no frontend;
- usar stub temporário apenas se explicitamente documentado e isolado;
- atualizar a documentação correspondente antes de consolidar o padrão.

## 18. Coerência com Backend e Runtime
A arquitetura de frontend deve permanecer coerente com:
- `07-backend-architecture.md`;
- `06-integration-contracts.md`;
- `10-realtime-and-events.md`;
- `18-deployment-and-runtime.md`.

O frontend deve assumir que:
- backend é o dono do estado operacional;
- realtime é projeção (atualmente não conectado, usando fallback por polling);
- integrações externas não são consumidas diretamente pela UI;
- o `desk-web` MVP já está implementado e operacional;
- hardening de produção é o próximo passo.

## 19. Regra de Precedência
Este documento orienta diretamente:
- estrutura do `desk-web`;
- organização de módulos de interface;
- consumo de API;
- consumo de realtime;
- padrões de estado da UI;
- implementação de telas operacionais.

Se houver conflito entre implementação e este documento, a implementação deve ser corrigida ou este arquivo atualizado explicitamente antes de prosseguir.
