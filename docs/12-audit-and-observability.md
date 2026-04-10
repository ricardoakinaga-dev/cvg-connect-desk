# Audit and Observability — CVG Connect Desk

## 1. Objetivo
Definir a estratégia de auditoria e observabilidade do **CVG Connect Desk** de forma coerente com:
- arquitetura alvo;
- backend;
- eventos e realtime;
- segurança e controle de acesso;
- operação real do hospital.

Este documento estabelece:
- diferença entre auditoria e observabilidade;
- eventos e ações auditáveis;
- logs estruturados;
- correlação de fluxos;
- troubleshooting;
- health e readiness;
- monitoramento mínimo;
- alertas operacionais.

## 2. Estado Atual do Repositório
No estado atual do repositório:
- `modules/audit` já possui implementação: repository, use cases e controller;
- audit trail implementado com tabela `audit_logs`;
- `apps/desk-api` já possui endpoints reais de `health` e `readiness`, além do logger básico do Fastify;
- `apps/message-worker` já possui worker implementado com polling e handlers;
- `apps/realtime-service` já possui servidor WebSocket implementado;
- logs estruturados JSON implementados com campos semânticos (`event_type`, `event_id`, `correlation_id`, `level`);
- Worker e Realtime emitem logs em JSON com nível explícito (`debug`/`info`/`warn`/`error`);
- Dead-letter com `retry_decision` e `failure_stage` para triagem operacional;
- este documento foi consolidado para refletir o estado real após a Fase 2 de observabilidade.

## 3. Princípios Gerais

### 3.1 Auditoria Não É a Mesma Coisa que Observabilidade
O sistema deve tratar auditoria e observabilidade como capacidades complementares, porém distintas.

- **Auditoria** responde: quem fez o quê, quando, sobre qual entidade e com qual contexto.
- **Observabilidade** responde: o que está acontecendo no sistema, onde falhou, por que falhou e como rastrear o fluxo técnico.

### 3.2 Rastreabilidade por Padrão
Toda ação e evento relevante deve ser rastreável com contexto suficiente para:
- operação;
- troubleshooting;
- investigação;
- governança;
- melhoria contínua.

### 3.3 Correlação Ponta a Ponta
Fluxos relevantes devem preservar correlação entre:
- inbound recebido;
- persistência;
- publicação de evento;
- consumo por worker;
- invocação de Secretary;
- outbound;
- projeção realtime.

### 3.4 Logs com Estrutura, Não Texto Solto
Logs devem ser estruturados, pesquisáveis e coerentes entre runtimes.

### 3.5 Observabilidade Sem Mentir Sobre Maturidade
Se determinada métrica, log ou pipeline ainda não estiver implementado, isso deve ser documentado como alvo, não como capacidade já pronta.

## 4. Auditoria

### 4.1 Objetivo da Auditoria
Preservar trilha histórica confiável das ações humanas e sistêmicas relevantes ao negócio e à operação.

### 4.2 O Que Deve Ser Auditável no Mínimo

#### 4.2.1 Conversas e Mensagens
- criação de conversa quando aplicável;
- mudança de status;
- assignment;
- aplicação ou remoção de tag quando aplicável;
- mensagem outbound solicitada ou enviada;
- handoff bot ↔ humano.

#### 4.2.2 Tasks
- criação;
- mudança de status;
- alteração de responsável;
- conclusão ou resolução.

#### 4.2.3 Notes
- criação de nota interna.

#### 4.2.4 Alerts
- criação;
- acknowledgment;
- resolução.

#### 4.2.5 Administração e Acesso
- criação ou alteração de usuário;
- alteração de papel ou permissão;
- mudanças relevantes de fila ou time;
- ações administrativas sensíveis.

#### 4.2.6 Integrações
- eventos sensíveis de Gateway ou Secretary quando houver impacto operacional relevante.

### 4.3 Estrutura Mínima do Registro Auditável
Cada registro de auditoria deve preservar, no mínimo:
- `actor_type`;
- `actor_user_id` quando aplicável;
- `action`;
- `entity_type`;
- `entity_id`;
- `created_at`;
- contexto mínimo útil em `context_json` ou equivalente.

Regras:
- auditoria deve ser append-only;
- o registro não deve ser sobrescrito para corrigir o passado;
- o contexto deve ser suficiente para investigação sem virar dump caótico de payload.

### 4.4 O Que Não Deve Virar Auditoria
Não transformar auditoria em:
- log técnico genérico;
- storage de payload cru sem critério;
- mecanismo de debug improvisado.

Auditoria é trilha de governança e operação, não substituto de logging técnico.

## 5. Observabilidade

### 5.1 Objetivo
Permitir entender o comportamento técnico do sistema e diagnosticar falhas com rapidez.

### 5.2 Pilares Mínimos Esperados
- logs estruturados;
- correlação de fluxo;
- health e readiness;
- métricas operacionais básicas;
- alertas operacionais relevantes.

## 6. Logs Estruturados

### 6.1 Requisitos Mínimos
Todos os runtimes relevantes devem produzir logs estruturados contendo, quando aplicável:
- timestamp;
- nível (`debug`, `info`, `warn`, `error`);
- serviço ou runtime;
- mensagem técnica curta;
- `correlation_id` quando existir;
- `event_id` quando existir;
- `aggregate_type` e `aggregate_id` quando fizer sentido;
- contexto de erro quando aplicável.
- `reason` ou código operacional quando o runtime estiver rejeitando ou classificando uma falha;
- `failureContext` resumido quando o evento tiver virado dead-letter e precisar de triagem.
- contadores/resumos operacionais quando o runtime expuser superfície mínima de triagem, como `/admin/dead-letters/stats` e `/admin/webhook-security/stats`.

### 6.2 Runtimes Esperados
Logs devem ser consistentes entre, no mínimo:
- `desk-api`;
- `message-worker` quando existir;
- `realtime-service` quando existir;
- integrações críticas.

### 6.3 Proibições
- logar segredo;
- logar token;
- logar senha ou hash de forma indevida;
- despejar payloads inteiros sem critério;
- usar texto sem estrutura como padrão principal.

### 6.4 Formato Real dos Logs — Worker e Realtime

Os runtimes `message-worker` e `realtime-service` emitem logs em JSON com a seguinte estrutura:

#### Worker (`apps/message-worker/src/index.ts`)

**Inicio do worker:**
```json
{"msg":"[Worker] Starting message worker","consumer_id":"worker","handlers":[...],"poll_interval_ms":500,"level":"info"}
```

**Processamento de evento:**
```json
{"msg":"[Worker] Processing handoff.completed","event_type":"handoff.completed","event_id":"...","correlation_id":"...","conversation_id":"...","level":"info"}
{"msg":"[Worker] Processing secretary.invocation","event_type":"secretary.invocation","event_id":"...","correlation_id":"...","conversation_id":"...","action":"...","status":"...","level":"info"}
{"msg":"[Worker] Processing message.persisted","event_type":"message.persisted","event_id":"...","correlation_id":"...","conversation_id":"...","direction":"inbound|outbound","level":"debug"}
```

**Falhas e retry:**
```json
{"msg":"[Worker] Retrying event after error","event_type":"...","event_id":"...","correlation_id":"...","handler":"...","attempt":1,"max_retries":3,"delay_ms":1000,"error":"...","level":"warn"}
{"msg":"[Worker] Non-retryable error — sending to dead-letter","event_type":"...","event_id":"...","correlation_id":"...","handler":"...","error":"...","retry_count":1,"retry_decision":"dead-letter","failure_stage":"worker-terminal","level":"error"}
{"msg":"[Worker] Max retries exceeded — sending to dead-letter","event_type":"...","event_id":"...","correlation_id":"...","handler":"...","error":"...","attempt":3,"max_retries":3,"retry_decision":"dead-letter","failure_stage":"worker-terminal","level":"error"}
```

**Secretary invocation failure:**
```json
{"msg":"[Worker] Secretary invocation failed","event_type":"secretary.invocation","event_id":"...","correlation_id":"...","conversation_id":"...","action":"...","status":"failed","error":"...","level":"warn"}
```

**Shutdown:**
```json
{"msg":"[Worker] Received SIGTERM, shutting down gracefully","level":"info"}
```

#### Realtime (`apps/realtime-service/src/index.ts`)

**Server lifecycle:**
```json
{"msg":"[Realtime] WebSocket server listening","port":8080,"level":"info"}
{"msg":"[Realtime] Event polling started","level":"info"}
{"msg":"[Realtime] Server stopped","level":"info"}
```

**Connections:**
```json
{"msg":"[Realtime] Legacy connection with token in URL","client_id":"...","auth_method":"url-token","level":"warn"}
{"msg":"[Realtime] New connection awaiting message-based auth","client_id":"...","level":"info"}
{"msg":"[Realtime] Client authenticated","client_id":"...","user_id":"...","level":"info"}
{"msg":"[Realtime] Connection closed","client_id":"...","level":"info"}
{"msg":"[Realtime] Client subscribed to channel","client_id":"...","channel":"...","level":"info"}
{"msg":"[Realtime] Client unsubscribed from channel","client_id":"...","channel":"...","level":"info"}
```

**Auth failures:**
```json
{"msg":"[Realtime] Authentication rejected","client_id":"...","reason":"...","close_code":4003,"level":"warn"}
{"msg":"[Realtime] Auth timeout, closing connection","client_id":"...","level":"warn"}
{"msg":"[Realtime] Token revalidation failed","client_id":"...","http_status":401,"level":"warn"}
{"msg":"[Realtime] Revalidation failure — closing connection","client_id":"...","reason":"Token revoked: 401","close_code":4002,"level":"warn"}
```

**Event processing:**
```json
{"msg":"[Realtime] Processing events from outbox","count":5,"level":"info"}
{"msg":"[Realtime] Skipping non-projectable event","event_type":"...","event_id":"...","level":"debug"}
{"msg":"[Realtime] Projected event","event_type":"message.persisted","aggregate_id":"...","aggregate_type":"Message","level":"info"}
{"msg":"[Realtime] Broadcast to channel","channel":"global","recipient_count":3,"level":"info"}
```

**Polling modes:**
```json
{"msg":"[Realtime] Using consumer-aware outbox for event polling","consumer":"realtime","level":"info"}
{"msg":"[Realtime] HTTP polling started","api_url":"http://localhost:3000","level":"info"}
```

#### Campos semânticos

| Campo | Descrição |
|-------|-----------|
| `msg` | Mensagem descritiva curta com prefixo do runtime |
| `event_type` | Tipo do evento do envelope (quando aplicável) |
| `event_id` | ID único do evento (quando aplicável) |
| `correlation_id` | ID de correlação do fluxo (quando aplicável) |
| `conversation_id` | ID da conversa afetada (quando aplicável) |
| `client_id` | ID do cliente WebSocket (realtime) |
| `user_id` | ID do usuário autenticado (realtime) |
| `auth_method` | `url-token` (legacy) ou `message-token` (recomendado) |
| `close_code` | Código de fechamento WebSocket (4001/4002/4003) |
| `handler` | Nome do handler que processou o evento (worker) |
| `attempt` | Tentativa atual de retry |
| `max_retries` | Máximo de tentativas configurado |
| `delay_ms` | Delay antes do próximo retry |
| `retry_decision` | `dead-letter` quando evento vai para DLQ |
| `failure_stage` | `worker-terminal` quando todos os retries se esgotaram |
| `level` | `debug`/`info`/`warn`/`error` — severidade segundo RFC 5424 |
| `consumer` | ID do consumer (`worker` ou `realtime`) |
| `poll_interval_ms` | Intervalo de polling em milissegundos |
| `recipient_count` | Número de clientes que receberam o broadcast |

## 7. Correlação e Traceabilidade

### 7.1 Objetivo
Conectar eventos e ações de um mesmo fluxo.

### 7.2 Identificadores Recomendados
Sempre que aplicável, preservar:
- `correlation_id`;
- `causation_id`;
- `event_id`;
- `external_message_id`;
- `conversation_id`.

### 7.3 Fluxos Críticos a Correlacionar
No mínimo:
- inbound Gateway → persistência de mensagem → evento interno;
- evento interno → worker → Secretary;
- decisão da Secretary → handoff;
- outbound → Gateway;
- evento interno → realtime → atualização de UI.

## 8. Health e Readiness

### 8.1 Objetivo
Permitir verificação operacional mínima de disponibilidade e prontidão.

### 8.2 Health
Deve responder se o processo principal está vivo.

### 8.3 Readiness
Deve responder se o serviço está apto a operar, considerando pelo menos:
- inicialização concluída;
- conectividade mínima com banco;
- dependências críticas quando fizer sentido;
- capacidade mínima de operar no contexto atual.

### 8.4 Regras
- health não deve mentir sobre readiness;
- readiness não deve ser simplificado a processo subiu;
- ambos devem ser coerentes com `18-deployment-and-runtime.md`.

## 9. Métricas Operacionais Mínimas
Mesmo que a pilha completa de métricas ainda não esteja pronta, a arquitetura deve suportar coleta e observação mínima de:
- volume de inbound;
- volume de outbound;
- falhas por integração;
- retries;
- handoffs;
- erros por runtime;
- tempo de resposta de rotas críticas quando aplicável.

Essas métricas podem evoluir por fase, mas não devem ficar totalmente implícitas.

## 10. Troubleshooting

### 10.1 Objetivo
Permitir diagnóstico rápido sem depender de adivinhação.

### 10.2 Requisitos Mínimos
Ao investigar um problema relevante, deve ser possível responder:
- qual requisição ou evento iniciou o fluxo;
- qual conversa ou entidade foi afetada;
- se houve erro de validação, integração ou processamento;
- se houve retry;
- se a entrada acabou em dead-letter e qual ação foi executada no admin (`retry` ou `resolve`);
- se o dead-letter preservou `sourceEvent` suficiente para replay do envelope original;
- se o dead-letter carrega `failureContext` estruturado com motivo, handler e decisão operacional;
- se o painel operacional consegue ver o resumo agregado em `/admin/dead-letters/stats` sem abrir cada item;
- se os bloqueios de webhook podem ser triados por `reason` agregado em `/admin/webhook-security/stats`;
- se o runtime realmente tinha boundary terminal para produzir dead-letter replayável;
- se houve evento publicado e consumido;
- se houve impacto em outbound ou realtime.

### 10.3 Regras
- falha deve preservar contexto suficiente;
- erro não pode ser engolido silenciosamente;
- logs, audit e eventos devem ser coerentes entre si.

## 11. Alertas Operacionais

### 11.1 Objetivo
Sinalizar situações que exigem ação humana ou investigação técnica.

### 11.2 Exemplos Mínimos
- falha persistente de outbound;
- falha recorrente de webhook;
- webhook com `reason` operacional claro na resposta e no log para `missing_secret`, `missing_signature`, `invalid_signature_format` e `invalid_signature`;
- consumer falhando repetidamente;
- retry excedido;
- dead-letter persistente sem tratamento no admin;
- dead-letter replayável sem tratamento no admin, mas com `sourceEvent` salvo aguardando `retry`;
- Secretary indisponível quando necessária ao fluxo;
- erro crítico de banco ou fila;
- readiness falhando.

### 11.3 Regras
- alerta operacional não deve depender de observação manual casual;
- alerta deve carregar contexto suficiente;
- alertas operacionais devem ser coerentes com o domínio de `alerts` quando houver integração entre técnico e operacional.

## 12. Fronteira Entre Auditoria, Log e Alerta

### 12.1 Auditoria
- orientada a ação, entidade e ator;
- foco em governança e rastreabilidade operacional.

### 12.2 Log
- orientado a diagnóstico técnico;
- foco em execução, falha e contexto técnico.

### 12.3 Alerta Operacional
- orientado a necessidade de intervenção;
- foco em risco, indisponibilidade ou degradação relevante.

O mesmo fato pode gerar:
- log técnico;
- registro auditável;
- alerta.

Mas cada mecanismo deve cumprir seu papel, sem duplicação caótica.

## 13. Regras de Implementação
Antes de implementar logging, auditoria, health, readiness ou monitoramento, é obrigatório:
- verificar o estado real do repositório;
- verificar se já existe mecanismo equivalente;
- verificar se a responsabilidade pertence ao backend, worker, realtime ou integração;
- impedir log solto sem padrão;
- impedir auditoria invisível ou inconsistente;
- impedir endpoint de health ou readiness enganoso;
- impedir vazamento de segredo em logs;
- impedir monitoramento que dependa de interpretação manual informal.

Se determinada capacidade ainda não estiver implementada:
- documentar como alvo arquitetural;
- não fingir que já existe;
- evitar consolidar pseudoobservabilidade como padrão definitivo.

## 14. Coerência com Outros Documentos
Este documento deve permanecer coerente com:
- `07-backend-architecture.md`;
- `09-data-model.md`;
- `10-realtime-and-events.md`;
- `11-security-and-access-control.md`;
- `13-dashboard-and-kpis.md`;
- `18-deployment-and-runtime.md`.

## 15. Regra de Precedência
Este documento orienta diretamente:
- logging estruturado;
- trilha auditável;
- correlação técnica;
- health e readiness;
- monitoramento e troubleshooting;
- geração de alertas operacionais relacionados ao runtime.

Se houver conflito entre implementação e este documento, a implementação deve ser corrigida ou este arquivo atualizado explicitamente antes de prosseguir.
