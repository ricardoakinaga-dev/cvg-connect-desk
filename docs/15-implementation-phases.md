# Implementation Phases — CVG Connect Desk

## 1. Objetivo
Transformar o roadmap definido em `14-roadmap.md` em tarefas executáveis, ordenadas e seguras para implementação incremental do **CVG Connect Desk**.

Este documento estabelece:
- tarefas concretas por fase;
- ordem exata de execução;
- onde cada entrega deve ser implementada;
- dependências técnicas reais;
- critérios de validação por etapa;
- regras para evitar conflito estrutural e implementação fora de ordem.

## 2. Estado Atual do Repositório
No estado atual do monorepo:
- `apps/desk-api` já possui bootstrap Fastify, `health`, `readiness` e rotas para `chat`, `tasks`, `notes`, `alerts`, `dashboard` e `auth`;
- `apps/desk-web` já possui frontend operacional com Inbox 3 colunas, Tasks, Alerts e Dashboard;
- `apps/message-worker` já possui worker implementado com handlers para handoff e alerts;
- `apps/realtime-service` já possui servidor WebSocket implementado;
- `packages/shared`, `packages/auth`, `packages/database` e `packages/events` já possuem implementação completa;
- `packages/realtime` já possui tipos e projeções para realtime;
- `modules/chat`, `modules/tasks`, `modules/notes`, `modules/alerts`, `modules/dashboard` e `modules/audit` já possuem repositories, use cases e controllers;
- `modules/secretary-adapter` já possui integração com Secretary;
- autenticação real implementada com login, logout, sessões e RBAC;
- audit trail implementado;
- realtime service implementado mas não conectado ao frontend (fallback por polling).

Regra de leitura:
- este documento reflete o estado atual do repositório;
- fases concluídas são marcadas explicitamente.

### 2.1 Status Atual de Execução
No momento deste rebaseline:
- Phase 0 — Foundation: concluída;
- Phase 1 — Core Chat: concluída;
- Phase 2 — Operations: concluída;
- Phase 3 — Integrations + Secretary: concluída;
- Phase 4 — Realtime: concluída;
- Phase 5 — Dashboard + Observability: concluída;
- Phase 6 — Frontend MVP: concluída;
- Phase 7 — Hardening + Production Readiness: concluída;
- Phase 8 — Refinement & Deployment: em andamento.

## 3. Princípio Central

### 3.1 Implementação Orientada a Dependência
Nada pode ser implementado fora da ordem estrutural abaixo:

```text
Data Model -> Repositories -> Use Cases -> Controllers -> Events -> Realtime -> UI
```

Quebrar essa ordem introduz:
- duplicação de regra;
- contratos frágeis;
- rotas sem base de persistência;
- eventos sem dono claro;
- UI acoplada a comportamento ainda não consolidado.

### 3.2 Ordem Canônica Entre Runtimes
A sequência obrigatória entre camadas e runtimes é:
- persistência antes de automação;
- API antes de worker;
- evento depois de persistência primária;
- realtime depois de eventos;
- frontend operacional depois de API e contratos estáveis.

### 3.3 Refinamento do Roadmap
Este documento detalha o roadmap em subfases executáveis mais finas.

Em especial:
- `Events + Worker` aparece aqui como fase explícita antes de `Realtime`;
- isso não contradiz `14-roadmap.md`;
- isso apenas torna operacional a regra já aprovada de que eventos estruturados vêm antes da projeção realtime.

## 4. Regras Globais de Execução

### 4.1 Verificação Obrigatória Antes de Criar Qualquer Artefato
Antes de implementar rota, repository, use case, evento, handler, query ou tela, é obrigatório:
- verificar se já existe artefato equivalente no repositório;
- verificar se já existe contrato documental aplicável;
- verificar se a responsabilidade pertence ao `app`, `module` ou `package` correto;
- verificar se a dependência anterior da cadeia já está pronta.

Se já existir:
- reutilizar;
- adaptar;
- não duplicar.

### 4.2 Proibições Globais
É proibido:
- criar rota sem use case correspondente;
- criar use case sem repository ou contrato de persistência correspondente;
- criar evento sem persistência primária anterior;
- criar worker para compensar ausência de modelagem síncrona;
- criar UI operacional antes de API e contratos estáveis;
- criar integração com Secretary antes do core de chat e operação interna estarem estáveis;
- criar KPI ou dashboard antes da definição formal em `13-dashboard-and-kpis.md`;
- criar tabela ou migration sem domínio claro e sem aderência a `09-data-model.md`.

### 4.3 Critério Mínimo de Conclusão de Etapa
Cada etapa só pode ser considerada concluída quando estiver:
- funcional;
- testável;
- observável em nível mínimo compatível com a fase;
- sem conflito estrutural com documentos anteriores;
- sem criar dívida arquitetural explícita para a fase seguinte.

## 5. Visão Geral das Fases

```text
Phase 0 -> Foundation
Phase 1 -> Core Chat
Phase 2 -> Operations
Phase 3 -> Integrations + Secretary
Phase 4 -> Events + Worker
Phase 5 -> Realtime
Phase 6 -> Dashboard
Phase 7 -> Hardening
```

## 6. Phase 0 — Foundation

### 6.1 Objetivo
Preparar a fundação mínima de banco, API e pacotes base para permitir implementação real sem atalhos inseguros.

### 6.2 Dependências de Entrada
- `07-backend-architecture.md` aprovado;
- `09-data-model.md` aprovado;
- `11-security-and-access-control.md` aprovado;
- `14-roadmap.md` aprovado.

### 6.3 Escopo Executável

#### 6.3.1 Database Setup
Onde implementar:
- `packages/database`

Tarefas:
- consolidar client de banco compatível com o padrão do projeto;
- estruturar runner de migration;
- preservar e evoluir o schema parcial de IAM já existente;
- preparar base incremental para novas migrations sem alteração destrutiva do que já existe.

Validação:
- banco conecta;
- migration atual de IAM continua coerente;
- novas migrations podem ser executadas sem quebrar a base existente.

#### 6.3.2 Shared Core
Onde implementar:
- `packages/shared`

Tarefas:
- criar `AppError`;
- criar padrão de `Result`;
- criar tipos utilitários mínimos compartilhados;
- criar convenções mínimas para erro e retorno interno.

Validação:
- backend consegue importar erro e resultado padronizados;
- não surgem tipos utilitários duplicados dentro de módulos.

#### 6.3.3 Auth Base
Onde implementar:
- `packages/auth`

Tarefas:
- preparar estrutura base de autenticação;
- preparar contratos de RBAC compatíveis com IAM;
- criar placeholders seguros para guards ou middlewares, sem fingir auth completa.

Validação:
- pacote possui fronteira clara para autenticação e autorização;
- nenhuma rota protegida depende de permissão hardcoded espalhada.

#### 6.3.4 API Bootstrap
Onde implementar:
- `apps/desk-api`

Tarefas:
- criar bootstrap de servidor Fastify;
- estruturar registro de plugins e módulos;
- criar endpoint de `health`;
- criar `readiness` inicial honesto, mesmo que simples;
- preparar base para registro futuro de rotas internas e webhook externo sem misturar contextos.

Validação:
- API sobe;
- `health` responde liveness;
- `readiness` não mente sobre dependências ainda ausentes;
- estrutura de inicialização permite evoluir sem controllers gordos.

### 6.4 Fora da Fase
- chat funcional;
- inbound e outbound reais;
- worker;
- realtime;
- dashboard operacional;
- integração com Secretary.

### 6.5 Critério de Saída da Fase
- API sobe de forma consistente;
- banco conecta e migrations rodam;
- base de IAM continua íntegra;
- pacotes `shared`, `auth` e `database` têm fronteiras mínimas claras;
- a fase seguinte pode criar domínio de chat sem improvisar infraestrutura base.

## 7. Phase 1 — Core Chat

### 7.1 Objetivo
Implementar o núcleo síncrono de conversa e mensagem com persistência primária, inbound, outbound básico e lifecycle operacional mínimo.

### 7.2 Dependências de Entrada
- Phase 0 concluída;
- contratos de integração aprovados em `06-integration-contracts.md`;
- modelagem de chat aprovada em `05-domain-model.md` e `09-data-model.md`.

### 7.3 Escopo Executável

#### 7.3.1 Data Model — Chat
Onde implementar:
- `packages/database`

Tarefas:
- criar migrations de `conversations`;
- criar migrations de `messages`;
- criar migrations de `conversation_assignments`;
- criar migrations de `conversation_status_history`;
- adicionar índices e constraints mínimas de idempotência e histórico;
- preservar separação entre estado atual e histórico.

Validação:
- PKs, FKs e índices aderem a `09-data-model.md`;
- `external_message_id` e `event_id` têm suporte adequado à deduplicação;
- assignment atual e histórico não ficam misturados.

#### 7.3.2 Repositories
Onde implementar:
- `modules/chat/infrastructure/repositories`

Tarefas:
- criar `conversation.repository`;
- criar `message.repository`;
- criar adapters de persistência para assignment e status history, se necessários para os use cases síncronos;
- manter mapeamento explícito entre modelo interno e schema relacional.

Validação:
- repository não vaza detalhe de transporte HTTP;
- regras de query e persistência ficam concentradas na infraestrutura do módulo.

#### 7.3.3 Use Cases
Onde implementar:
- `modules/chat/application/use-cases`

Tarefas:
- criar `createConversation`;
- criar `receiveInboundMessage`;
- criar `sendOutboundMessage`;
- criar casos mínimos de assignment e transição de status, se necessários para sustentar o lifecycle básico;
- garantir persistência antes de qualquer publicação de evento.

Validação:
- inbound gera conversa ou vincula à conversa correta;
- outbound persiste intenção e mensagem antes de envio;
- transações síncronas permanecem curtas e limitadas ao estado primário.

#### 7.3.4 Controllers e Schemas
Onde implementar:
- `modules/chat/presentation/http`
- `apps/desk-api`

Tarefas:
- criar handler de webhook inbound;
- criar endpoint interno de envio outbound;
- criar schemas de entrada e saída;
- registrar rotas no `desk-api` sem misturar regra de negócio no controller.

Validação:
- webhook valida e normaliza antes de tocar o core;
- endpoint interno chama use case explícito;
- nenhuma rota acessa banco diretamente.

#### 7.3.5 Publicação Inicial de Eventos
Onde implementar:
- `modules/chat/application`
- `packages/events` somente se a fundação mínima já estiver pronta para isso

Tarefas:
- publicar eventos mínimos após persistência primária;
- priorizar `message.inbound.received` e `message.persisted`;
- só introduzir `message.outbound.requested` quando o fluxo estiver claro e rastreável.

Validação:
- evento só nasce depois de persistência primária;
- payload interno é normalizado;
- nenhum evento substitui o use case síncrono.

### 7.4 Fora da Fase
- tasks;
- notes;
- alerts derivados complexos;
- Secretary;
- realtime;
- dashboard.

### 7.5 Critério de Saída da Fase
- inbound chega, valida e persiste;
- outbound básico funciona com rastreabilidade mínima;
- conversa possui lifecycle mínimo com estado atual e histórico coerentes;
- chat pode servir de base para operação interna.

## 8. Phase 2 — Operations

### 8.1 Objetivo
Adicionar a camada operacional interna sobre o chat já persistido.

### 8.2 Dependências de Entrada
- Phase 1 concluída;
- contexto operacional mínimo disponível no banco;
- fronteiras de `tasks`, `notes` e `alerts` aprovadas em `05-domain-model.md`.

### 8.3 Escopo Executável

#### 8.3.1 Data Model — Operations
Onde implementar:
- `packages/database`

Tarefas:
- criar migrations de `tasks`;
- criar migrations de `task_status_history`;
- criar migrations de `internal_notes`;
- criar migrations de `alerts`;
- criar migrations de `alert_events`;
- criar tabelas auxiliares mínimas de `contacts`, `tutors`, `patients` e `tutor_patients` caso ainda não tenham sido introduzidas antes e sejam necessárias ao vínculo operacional.

Validação:
- tasks, notes e alerts ficam aderentes ao modelo de domínio;
- histórico e estado atual continuam separados;
- FKs e índices suportam navegação operacional.

#### 8.3.2 Repositories e Use Cases
Onde implementar:
- `modules/tasks`
- `modules/notes`
- `modules/alerts`

Tarefas:
- criar repositories mínimos de tasks, notes e alerts;
- criar `createTask`;
- criar `updateTaskStatus`;
- criar `createNote`;
- criar `createAlert`;
- criar operações mínimas de `acknowledgeAlert` e `resolveAlert` se o fluxo exigir isso para fechar o lifecycle mínimo.

Validação:
- task pode ser vinculada a contexto permitido;
- note preserva autoria e referência;
- alert preserva estado atual e histórico separado.

#### 8.3.3 Integração com Chat
Onde implementar:
- `modules/chat`
- `modules/tasks`
- `modules/notes`
- `modules/alerts`

Tarefas:
- vincular task à conversation quando aplicável;
- vincular alerts à conversation ou task quando aplicável;
- expor leitura contextual mínima para painel operacional futuro;
- evitar acoplamento rico entre módulos, usando IDs e contratos internos.

Validação:
- operação interna consegue atuar sobre conversa real;
- contexto operacional não vira dependência circular entre módulos.

### 8.4 Fora da Fase
- automação complexa;
- Secretary;
- realtime;
- KPI;
- analytics avançado.

### 8.5 Critério de Saída da Fase
- tasks funcionam;
- notes internas estão disponíveis;
- alerts básicos funcionam com lifecycle rastreável;
- chat e operação interna já sustentam atendimento básico real.

## 9. Phase 3 — Integrations + Secretary

### 9.1 Objetivo
Integrar a Secretary de forma controlada, rastreável e isolada do core do sistema.

### 9.2 Dependências de Entrada
- Phase 1 concluída;
- Phase 2 concluída;
- contratos de integração aprovados em `06-integration-contracts.md`;
- segurança de fronteira mínima definida em `11-security-and-access-control.md`.

### 9.3 Escopo Executável

#### 9.3.1 Secretary Adapter
Onde implementar:
- `modules/secretary-adapter`
- `packages/integrations`

Tarefas:
- criar request builder para Secretary;
- criar response handler;
- isolar mapeamento entre contrato interno e contrato externo;
- criar fallback seguro;
- impedir que múltiplos módulos falem diretamente com a Secretary.

Validação:
- adapter é o único ponto de integração com a IA;
- payload externo não vaza cru para o core.

#### 9.3.2 Use Cases
Onde implementar:
- `modules/secretary-adapter/application/use-cases`
- integração com `modules/chat/application`

Tarefas:
- criar `handleSecretaryResponse`;
- criar `triggerHandoff`;
- registrar metadados mínimos de invocação e decisão;
- garantir que a Secretary não altere estado diretamente sem mediação do Desk.

Validação:
- handoff é decidido e persistido pelo Desk;
- resposta da Secretary não contorna o core.

#### 9.3.3 Eventos de Handoff
Onde implementar:
- `packages/events`
- `modules/secretary-adapter`

Tarefas:
- publicar `handoff.requested`;
- publicar `handoff.completed`;
- preparar também `secretary.invocation.requested/completed/failed` quando a implementação já suportar isso sem ambiguidade.

Validação:
- fluxo bot ↔ humano é rastreável;
- eventos preservam correlação entre conversa, invocação e resultado.

### 9.4 Fora da Fase
- autonomia irrestrita da IA;
- decisões clínicas automáticas;
- reescrita de gateway ou Secretary;
- realtime.

### 9.5 Critério de Saída da Fase
- integração com Secretary ocorre por adapter único;
- handoff funciona;
- fallback seguro existe;
- integração não contamina core, contratos internos nem modelo de domínio.

## 10. Phase 4 — Events + Worker

### 10.1 Objetivo
Consolidar o pipeline interno de eventos e o processamento assíncrono controlado depois que o estado primário já está estável.

### 10.2 Dependências de Entrada
- Phase 1 concluída;
- preferencialmente Phase 2 concluída;
- se houver Secretary assíncrona, Phase 3 concluída;
- envelope e princípios de evento aprovados em `10-realtime-and-events.md`.

### 10.3 Escopo Executável

#### 10.3.1 Event System
Onde implementar:
- `packages/events`

Tarefas:
- criar event envelope;
- criar contratos internos versionáveis;
- criar publisher base;
- criar contratos ou abstrações mínimas de consumer;
- preparar suporte mínimo de idempotência e metadata.

Validação:
- evento interno tem envelope consistente;
- versionamento e correlação estão explícitos;
- payload externo cru continua proibido.

#### 10.3.2 Worker
Onde implementar:
- runtime `message-worker` ou papel operacional equivalente claramente isolado do `desk-api`

Tarefas:
- criar consumer básico;
- criar estratégia de retry controlado;
- criar tratamento de falha observável;
- impedir que o worker vire fonte primária de verdade.

Validação:
- consumer reprocessa com segurança;
- retry é limitado e rastreável;
- falha persistente pode ser observada.

#### 10.3.3 Event Handlers
Onde implementar:
- `modules/alerts`
- `modules/tasks`
- `modules/secretary-adapter` quando aplicável

Tarefas:
- introduzir handlers que reajam a eventos já persistidos;
- permitir `message -> alert` quando houver regra clara;
- permitir `message -> task` apenas se houver regra explícita de negócio e sem expandir escopo;
- acionar Secretary de forma assíncrona só quando isso não inverter dependência nem esconder lógica crítica.

Validação:
- nenhum handler substitui persistência síncrona primária;
- cada consumer tem dono claro;
- efeitos secundários são auditáveis.

### 10.4 Fora da Fase
- UI realtime;
- dashboards;
- otimizações prematuras de bus.

### 10.5 Critério de Saída da Fase
- eventos são publicados com envelope consistente;
- worker consome com retry controlado;
- efeitos secundários principais estão desacoplados da API sem perder rastreabilidade.

## 11. Phase 5 — Realtime

### 11.1 Objetivo
Projetar na interface mudanças já aceitas pelo backend, sem transformar realtime em fonte de verdade.

### 11.2 Dependências de Entrada
- Phase 4 concluída;
- contratos de realtime aprovados em `10-realtime-and-events.md`;
- frontend preparado para bootstrap por API e reconciliação incremental.

### 11.3 Escopo Executável

#### 11.3.1 Realtime Service
Onde implementar:
- `packages/realtime`
- runtime `realtime-service` ou papel equivalente claramente separado do `desk-api`

Tarefas:
- criar servidor websocket ou canal equivalente;
- criar autenticação básica do canal;
- criar serialização de contratos de realtime;
- garantir que o canal consuma projeções derivadas de eventos internos.

Validação:
- canal realtime exige autenticação compatível;
- payload enviado à UI é interno e tipado.

#### 11.3.2 Event -> UI Projection
Onde implementar:
- `packages/realtime`
- `apps/desk-web`

Tarefas:
- projetar `message.persisted` ou equivalente para atualização de timeline;
- projetar `conversation.status.changed` e `conversation.assigned` para atualização de lista;
- projetar mudanças relevantes de task e alert;
- garantir fallback temporário de revalidação ou polling controlado se alguma projeção ainda não estiver disponível.

Validação:
- UI atualiza de forma incremental;
- reconnect e revalidação não criam estado paralelo;
- realtime continua sendo projeção, não bootstrap.

### 11.4 Fora da Fase
- lógica de negócio no canal realtime;
- cálculo de KPI;
- automação extra.

### 11.5 Critério de Saída da Fase
- UI reflete eventos aceitos pelo backend;
- reconexão funciona;
- ausência eventual do canal realtime ainda pode ser mitigada por fallback controlado sem violar os contratos.

## 12. Phase 6 — Dashboard

### 12.1 Objetivo
Expor visibilidade operacional e gerencial mínima com KPIs definidos formalmente.

### 12.2 Dependências de Entrada
- Phase 2 concluída;
- Phase 4 concluída;
- preferencialmente Phase 5 concluída para atualização incremental;
- `13-dashboard-and-kpis.md` aprovado;
- `12-audit-and-observability.md` aprovado em seus requisitos mínimos.

### 12.3 Escopo Executável

#### 12.3.1 KPI Endpoints
Onde implementar:
- `modules/dashboard`
- `apps/desk-api`

Tarefas:
- criar endpoints ou contratos internos equivalentes para KPIs aprovados;
- priorizar conversas abertas, tasks vencidas e alerts ativos;
- só expor tempo médio de primeira resposta, tempo médio de resposta, volume de conversas e taxa de handoff quando a base de dados e eventos suportarem cálculo confiável.

Validação:
- nenhum KPI existe sem fonte, fórmula, janela temporal e owner claro;
- frontend não calcula KPI canônico.

#### 12.3.2 Queries Agregadas
Onde implementar:
- `modules/dashboard/infrastructure`
- `packages/database`

Tarefas:
- criar queries agregadas simples;
- usar índices existentes;
- evitar materialização prematura;
- documentar timezone, janela temporal e regra de arredondamento.

Validação:
- KPI é consistente com `09-data-model.md`, `10-realtime-and-events.md` e `12-audit-and-observability.md`;
- a mesma métrica não é calculada de múltiplas formas.

### 12.4 Fora da Fase
- BI avançado;
- analytics analítico;
- ML;
- engine complexa de métricas materializadas sem necessidade comprovada.

### 12.5 Critério de Saída da Fase
- KPIs mínimos ficam disponíveis no backend;
- dashboard consome contratos canônicos;
- não existe cálculo duplicado no frontend;
- troubleshooting básico das métricas já é possível.

## 13. Phase 7 — Hardening

### 13.1 Objetivo
Elevar o runtime para um nível compatível com operação real, com segurança, observabilidade e resiliência mínimas.

### 13.2 Dependências de Entrada
- fases anteriores concluídas conforme escopo necessário;
- fluxos principais de chat, operação, integração e eventos já estáveis.

### 13.3 Escopo Executável

#### 13.3.1 Security
Onde implementar:
- `packages/auth`
- `apps/desk-api`
- `packages/realtime`

Tarefas:
- concluir autenticação interna;
- concluir RBAC;
- proteger rotas internas;
- endurecer webhook;
- separar credenciais de integrações externas;
- aplicar gestão de segredos e rotação compatível com runtime.

Validação:
- backend é a autoridade final;
- permissão não fica hardcoded espalhada;
- webhook e rotas internas usam proteções adequadas a seus contextos.

#### 13.3.2 Observability
Onde implementar:
- `modules/audit`
- `packages/shared`
- `apps/desk-api`
- `message-worker`
- `realtime-service`

Tarefas:
- consolidar logs estruturados;
- propagar `correlation_id`;
- consolidar audit trail mínimo;
- amadurecer `health` e `readiness`;
- preparar monitoramento e alertas operacionais mínimos.

Validação:
- logs são estruturados e sem vazamento de segredo;
- troubleshooting ponta a ponta é possível;
- audit e log não se confundem.

#### 13.3.3 Retry, Failure e Operabilidade
Onde implementar:
- `packages/events`
- `message-worker`
- integrações críticas

Tarefas:
- consolidar retry controlado;
- introduzir quarentena ou dead-letter quando aplicável e suportado pelo stack;
- tratar falhas persistentes com observabilidade suficiente;
- revisar limites de timeout, reprocessamento e fallback.

Validação:
- sistema falha de forma observável;
- retry não é infinito;
- falha crítica gera contexto suficiente para investigação.

### 13.4 Critério de Saída da Fase
- sistema está resiliente o suficiente para operação real;
- segurança mínima obrigatória está aplicada;
- observabilidade mínima obrigatória está operacional;
- falhas relevantes podem ser detectadas, investigadas e tratadas.

## 14. Dependências Técnicas Reais

### 14.1 Cadeia Estrutural
As dependências reais devem seguir:

```text
Schema e migration
-> repositories
-> use cases
-> handlers/controllers
-> publicação de eventos
-> consumers/worker
-> realtime projection
-> UI operacional
-> dashboard e KPIs
-> hardening final
```

### 14.2 Relações Críticas
- `conversations` precede `messages`;
- `messages` precede `inbound` e `outbound` reais;
- chat persistido precede tasks, notes e alerts;
- contratos da Secretary precedem adapter e handoff;
- eventos consistentes precedem worker;
- worker e eventos consistentes precedem realtime;
- data model e KPIs definidos precedem dashboard;
- autenticação e RBAC completos podem ser concluídos no hardening, mas a fundação de segurança não pode ser ignorada desde a Phase 0.

## 15. Regra de Precedência
Este documento orienta diretamente:
- ordem de criação de código;
- decomposição de trabalho por fase;
- dependências entre banco, backend, eventos, realtime e UI;
- critérios mínimos de validação por etapa.

Se houver conflito entre execução e este documento:
- a implementação deve ser corrigida; ou
- este arquivo deve ser atualizado explicitamente antes de prosseguir.
