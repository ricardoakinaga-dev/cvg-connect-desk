# Realtime and Events — CVG Connect Desk

## 1. Objetivo
Definir o modelo de eventos internos e a estratégia de realtime do **CVG Connect Desk** de forma executável, coerente com a arquitetura do sistema e segura para implementação incremental.

Este documento estabelece:
- papel dos eventos internos;
- envelope de eventos;
- responsabilidades de publicação e consumo;
- regras de idempotência;
- estratégia de retry;
- projeção realtime para a interface;
- limites explícitos entre API, worker e frontend.

## 2. Estado Atual do Repositório
No estado atual do monorepo:
- `packages/events` já possui implementação de `event envelope`, publisher em memória, consumer com idempotência e retry com backoff;
- `packages/realtime` já possui tipos e projeções para eventos realtime;
- `apps/realtime-service` já possui servidor WebSocket implementado com autenticação, canais e broadcast;
- `apps/message-worker` já possui worker implementado com polling de eventos e handlers para handoff e alerts;
- `apps/desk-api` já publica eventos no fluxo de chat e operations;
- `apps/desk-web` possui fallback por polling (não possui conexão realtime ativa ainda);
- a arquitetura abaixo descreve o **estado atual** e o **alvo de evolução**.

Este documento reflete o que já foi implementado e o que ainda pode evoluir (conexão realtime ativa).

## 3. Princípios Gerais

### 3.1 Eventos Internos como Mecanismo de Desacoplamento
Eventos internos devem ser usados para desacoplar:
- efeitos secundários;
- projeções;
- integrações auxiliares;
- notificações em tempo real.

Eles não devem ser usados para esconder lógica crítica sem rastreabilidade.

### 3.2 Persistência Primária Antes de Propagação
O estado operacional primário deve ser persistido antes de ser propagado por eventos, salvo exceção muito específica e documentada.

Regra:
- API persiste o estado primário;
- depois publica evento interno;
- worker e realtime consomem esse evento.

### 3.3 Realtime como Projeção
O realtime deve refletir mudanças já aceitas pelo backend.

Ele não é:
- fonte primária de verdade;
- mecanismo de decisão de negócio;
- substituto da carga inicial por API.

### 3.4 Idempotência Obrigatória
Todo processamento de evento deve considerar possibilidade de duplicação.

A estratégia de idempotência deve existir para:
- inbound externo;
- publicação e consumo interno;
- projeções derivadas;
- notificações realtime, quando aplicável.

## 4. Papel dos Eventos Internos
Eventos internos existem para:
- notificar mudança de estado relevante;
- permitir processamento assíncrono;
- alimentar projeções;
- acionar integrações derivadas;
- atualizar frontend via realtime.

Eles não devem:
- substituir comando ou use case explícito;
- transportar payload cru externo para o core;
- criar dependência oculta entre módulos.

## 5. Event Envelope Padrão
Todo evento interno deve seguir envelope consistente.

Estrutura conceitual mínima:

```json
{
  "event_id": "string",
  "event_type": "string",
  "event_version": "number",
  "aggregate_type": "string",
  "aggregate_id": "string",
  "occurred_at": "ISO8601",
  "correlation_id": "string|null",
  "causation_id": "string|null",
  "version": "number",
  "payload": {},
  "metadata": {}
}
```

### 5.1 Campos Mínimos Obrigatórios
- `event_id`: identificador único do evento interno;
- `event_type`: nome canônico do evento;
- `event_version`: versao explicita do contrato do evento;
- `aggregate_type`: domínio raiz relacionado;
- `aggregate_id`: ID da entidade raiz;
- `occurred_at`: timestamp do fato;
- `version`: versão operacional do aggregate no outbox;
- `payload`: dados relevantes já normalizados;
- `metadata`: metadados auxiliares.

### 5.2 Campos Recomendados
- `correlation_id`;
- `causation_id`.

## 6. Regras do Envelope

### 6.1 Payload Limpo
`payload` deve conter apenas dados internos normalizados e necessários ao consumo.

É proibido:
- vazar payload cru de Gateway;
- vazar payload cru da Secretary;
- usar evento interno como dump de integração externa.

### 6.2 Versionamento
Eventos internos devem ser versionáveis quando houver risco de evolução incompatível.

A estratégia exata pode ser:
- `event_version` explícito;
- nomenclatura versionada;
- convenção equivalente documentada.

Eventos sem estratégia mínima de evolução são proibidos.

### 6.3 Correlação
Sempre que aplicável, o sistema deve preservar:
- `correlation_id` para rastrear fluxo de ponta a ponta;
- `causation_id` para indicar o evento ou comando que originou outro evento.

Isso é especialmente útil para:
- inbound → persistência → projeção → handoff → outbound;
- troubleshooting;
- auditoria.

## 7. Eventos Internos Esperados
A lista abaixo é exemplificativa e obrigatória em nível conceitual.

### 7.1 Chat
- `conversation.created`;
- `conversation.assigned`;
- `conversation.status.changed`;
- `message.inbound.received`;
- `message.outbound.requested`;
- `message.persisted`.

### 7.2 Tasks
- `task.created`;
- `task.status.changed`;
- `task.overdue`.

### 7.3 Notes
- `note.created`.

### 7.4 Alerts
- `alert.created`;
- `alert.acknowledged`;
- `alert.resolved`.

### 7.5 Handoff / Secretary
- `handoff.requested`;
- `handoff.completed`;
- `secretary.invocation.requested`;
- `secretary.invocation.completed`;
- `secretary.invocation.failed`.

### 7.6 Admin / Audit Relevantes
- `user.created` quando aplicável;
- `role.updated` quando aplicável;
- outros eventos administrativos apenas quando houver valor operacional claro.

## 8. Publicadores e Consumidores

### 8.1 API (`apps/desk-api`)
Pode publicar eventos após:
- persistir conversa;
- persistir mensagem;
- mudar status;
- atribuir responsável;
- criar task;
- criar note;
- abrir, reconhecer ou resolver alert;
- registrar handoff quando o fluxo for síncrono.

Regra:
- a API não deve publicar evento otimista sem persistência primária confirmada, salvo exceção documentada.

### 8.2 Worker (`message-worker`)
Pode consumir eventos para:
- retries;
- alertas derivados;
- tasks derivadas;
- integrações assíncronas;
- invocação controlada da Secretary;
- efeitos secundários auditáveis.

Regra:
- worker não cria verdade primária invisível;
- mudanças de estado feitas por worker devem ser rastreáveis e persistidas adequadamente.
- quando uma falha se torna terminal, o worker grava dead-letter com o `sourceEvent` original para permitir replay administrativo contextual.

### 8.3 Realtime (`realtime-service`)
Pode consumir eventos para:
- atualizar lista de conversas;
- atualizar conversa ativa;
- atualizar task relacionada;
- atualizar alertas;
- notificar mudança relevante na UI.

Regra:
- realtime só projeta;
- não decide;
- não persiste estado primário.
- eventos não projetáveis são ackados/ignorados para evitar dead-letter replayável sem boundary terminal real.

## 9. Fluxo Entre API, Worker e Frontend

### 9.1 Fluxo Canônico
1. API recebe comando ou inbound normalizado.
2. API valida e persiste estado primário.
3. API publica evento interno.
4. Worker consome se houver efeito assíncrono.
5. Realtime consome para projetar na UI.
6. Frontend reconcilia estado remoto e cache.

### 9.2 Regra Crítica
Frontend nunca deve depender exclusivamente do realtime para bootstrap de estado.

A carga inicial deve vir da API.

## 10. Idempotência

### 10.1 Inbound Externo
Mensagens e eventos vindos do Gateway devem considerar:
- `event_id`;
- `external_message_id`;
- outros identificadores estáveis disponíveis.

A deduplicação deve ser apoiada por persistência, não só por memória.

### 10.2 Eventos Internos
Consumidores internos devem ser seguros contra reprocessamento.

Estratégias aceitáveis incluem:
- tabela de processamento de eventos;
- `idempotency_key` por consumer;
- unicidade apoiada pelo banco;
- combinação equivalente documentada.

### 10.3 Realtime
O frontend e/ou o `realtime-service` devem tolerar:
- evento repetido;
- evento fora de ordem;
- reconnect;
- revalidação posterior.

O sistema não deve assumir entrega perfeita.

## 11. Ordem, Consistência e Entrega

### 11.1 Ordem
Ordem global perfeita não deve ser presumida.

Quando necessária, a consistência deve ser garantida por:
- timestamps confiáveis;
- ordenação por agregado;
- política de reconciliação;
- revalidação por API.

### 11.2 Entrega
O sistema deve ser projetado para pelo menos:
- entrega com possibilidade de duplicação;
- reprocessamento seguro;
- reconciliação posterior.

Não assumir sem documentação:
- exactly-once;
- ordenação global;
- entrega infalível.

## 12. Retry e Falhas

### 12.1 Retry
Retries devem existir para:
- falhas transitórias de integração;
- falhas transitórias de consumer;
- envio outbound quando aplicável.

Regras:
- retry deve ser limitado;
- retry deve ser observável;
- retry deve preservar contexto de erro;
- retry infinito é proibido.

### 12.2 Falhas Permanentes
Quando a falha não puder ser resolvida por retry controlado, o sistema deve:
- registrar erro com contexto suficiente;
- permitir troubleshooting;
- gerar alert operacional quando aplicável.

### 12.3 Dead Letter / Quarentena
Se o stack adotado suportar, deve existir estratégia clara para:
- dead-letter queue;
- quarentena de eventos problemáticos;
- reprocessamento manual ou controlado.

Se ainda não for implementado na fase atual, isso deve ficar registrado como alvo operacional futuro, não omitido.

## 13. Realtime Projection

### 13.1 Objetivo
Projetar para a UI mudanças relevantes já aceitas pelo sistema.

Exemplos:
- nova mensagem em conversa aberta;
- atualização da fila ou lista;
- mudança de assignment;
- task criada ou atualizada;
- alert criado, acknowledged ou resolvido;
- handoff relevante para a operação.

### 13.2 Regras
- projeção realtime deve usar contratos internos do Desk;
- payload realtime não deve expor detalhes desnecessários do backend;
- frontend deve tratar realtime como atualização incremental;
- fallback para revalidação ou polling controlado é permitido quando realtime não estiver implementado.

## 14. Contratos de Realtime
Os contratos de realtime devem:
- ser tipados;
- ser derivados do estado interno do Desk;
- evitar payload excessivo;
- conter informação suficiente para reconciliação de cache e UI.

Eles não devem:
- espelhar payload cru de evento interno sem filtro;
- virar API paralela sem governança;
- carregar lógica de negócio implícita.

## 15. Auditoria e Observabilidade dos Eventos
O pipeline de eventos deve ser observável.

No mínimo, deve ser possível rastrear:
- publicação do evento;
- consumo do evento;
- falha de consumo;
- retry;
- correlação com aggregate e fluxo original.

Sempre que aplicável, isso deve ser coerente com:
- `audit_logs`;
- logs estruturados;
- alertas operacionais.

## 16. Regras de Implementação
Antes de criar publishers, consumers, handlers ou contratos realtime, é obrigatório:
- verificar o estado real do repositório;
- verificar se já existe contrato ou evento equivalente;
- verificar se a responsabilidade é da API, do worker ou do realtime;
- impedir evento redundante ou sem dono claro;
- impedir consumer com regra de negócio invisível;
- impedir realtime como fonte de verdade;
- impedir payload cru de integração externa no bus interno.

Se determinado runtime ainda não existir:
- documentar como alvo arquitetural;
- não fingir implementação pronta;
- evitar consolidar contrato que dependa de componente inexistente sem marcar isso explicitamente.

## 17. Coerência com Outros Documentos
Este documento deve permanecer coerente com:
- `04-target-architecture.md`;
- `06-integration-contracts.md`;
- `07-backend-architecture.md`;
- `08-frontend-architecture.md`;
- `09-data-model.md`;
- `12-audit-and-observability.md`;
- `18-deployment-and-runtime.md`.

## 18. Regra de Precedência
Este documento orienta diretamente:
- contratos internos de eventos;
- publishers e consumers;
- idempotência de processamento interno;
- projeções realtime;
- retries e falhas operacionais relacionadas ao bus.

Se houver conflito entre implementação e este documento, a implementação deve ser corrigida ou este arquivo atualizado explicitamente antes de prosseguir.
