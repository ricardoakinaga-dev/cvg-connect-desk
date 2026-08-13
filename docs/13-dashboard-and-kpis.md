# Dashboard and KPIs — CVG Connect Desk

## 1. Objetivo
Definir os indicadores e a estratégia de dashboard do **CVG Connect Desk** de forma:
- executável;
- auditável;
- consistente com o modelo de dados;
- coerente com backend, eventos e observabilidade.

Este documento estabelece:
- quais KPIs existem;
- como são calculados;
- de onde vêm os dados;
- quando são atualizados;
- limites de interpretação;
- diferença entre dashboard operacional, gerencial e analítico.

## 2. Estado Atual do Repositório
No estado atual do repositório:
- `modules/dashboard` já possui implementation de use cases para KPIs: getDashboardSummary, getConversationMetrics, getTaskMetrics, getAlertMetrics;
- `modules/dashboard` já possui endpoints HTTP: /metrics/summary, /metrics/conversations, /metrics/tasks, /metrics/alerts;
- `apps/desk-web` já possui página de Dashboard que consome KPIs reais do backend;
- KPIs implementados: conversas abertas, conversas pendentes, tasks vencidas, tasks por status, alertas ativos, alertas por severidade;
- KPIs NÃO implementados: tempo médio de primeira resposta, tempo médio de resposta, taxa de handoff (sem dados suficientes);
- este documento reflete o **estado atual** e o **alvo de expansão**.

Este documento afirma o que já foi implementado e o que ainda não possui fonte de dados.

## 3. Princípios Gerais

### 3.1 KPI sem Fonte Definida É Proibido
Todo KPI deve declarar explicitamente:
- origem em tabela ou campo;
- regra de cálculo;
- filtro;
- janela temporal.

### 3.2 Backend É Dono do Cálculo
- frontend não calcula KPI canônico;
- frontend apenas exibe;
- backend define e entrega.

### 3.3 Uma Definição Única por KPI
- não pode existir múltiplas interpretações do mesmo indicador;
- não pode existir cada tela calcula de um jeito.

### 3.4 Métrica Não É Evento Bruto
Eventos e dados brutos precisam ser:
- filtrados;
- agregados;
- contextualizados;

antes de virar KPI.

### 3.5 Evitar Over-Engineering Precoce
Nesta fase:
- preferir query agregada;
- evitar materialização prematura;
- só criar tabela de métricas se necessário.

## 4. Tipos de Dashboard

### 4.1 Dashboard Operacional
Uso:
- equipe de atendimento.

Foco:
- o que está acontecendo agora.

Exemplos:
- conversas abertas;
- fila atual;
- tarefas pendentes;
- alerts ativos.

### 4.2 Dashboard Gerencial
Uso:
- gestor.

Foco:
- desempenho agregado.

Exemplos:
- tempo médio de resposta;
- volume por período;
- taxa de handoff;
- tarefas vencidas.

### 4.3 Dashboard Analítico
Uso:
- inteligência, análise ou IA.

Foco:
- padrões e tendências.

Regra:
- fica fora do escopo atual como implementação obrigatória.

## 5. KPIs Operacionais Mínimos

### 5.1 Conversas Abertas

**Definição**

Quantidade de conversas com status ativo.

**Fonte**
- `conversations.current_status`.

**Regra**

```sql
count(*) where current_status in ('open', 'pending')
```

**Atualização**
- leitura direta do banco ou query agregada equivalente.

**Janela Temporal**
- fotografia do momento atual no timezone operacional configurado.

**Limite**
- depende da definição formal de quais status contam como operacionais e abertos.

### 5.2 Tempo Médio de Primeira Resposta

**Status:** ✅ **IMPLEMENTED** — Endpoint `/metrics/first-response-time`

**Definição**

Tempo entre a primeira mensagem inbound da conversa e a primeira resposta humana.

**Fonte**
- `messages.occurred_at`;
- `messages.sender_type`;
- `messages.direction`.

**Regra**
- identificar a primeira inbound da conversa;
- identificar a primeira outbound humana;
- calcular a diferença;
- agregar a média dentro da janela definida.

**Fórmula**

```text
avg(first_human_outbound_at - first_inbound_at)
```

**Observação**
- bot não conta como resposta humana.

**Janela Temporal**
- por padrão, deve ser agregada em janela explícita definida pelo backend, como `24h`, `7d` ou período informado pela consulta.

**Limite**
- conversas sem resposta humana ainda não entram no denominador como respondidas.

### 5.3 Tempo Médio de Resposta

**Status:** ✅ **IMPLEMENTED** — Endpoint `/metrics/conversations/volume`

**Definição**

Tempo médio entre mensagens inbound e a resposta humana subsequente.

**Fonte**
- `messages`.

**Regra**
- formar pares inbound → outbound humano;
- calcular o delta entre os pares válidos;
- agregar a média dentro da janela definida.

**Fórmula**

```text
avg(outbound_humano_subsequente_at - inbound_at)
```

**Janela Temporal**
- por padrão, deve ser agregada em janela explícita definida pelo backend, como `24h`, `7d` ou período informado pela consulta.

**Limite**
- pares malformados, múltiplas respostas encadeadas ou ausência de resposta exigem regra explícita de exclusão.

### 5.4 Volume de Conversas

**Definição**

Número de conversas iniciadas em um período.

**Fonte**
- `conversations.created_at`.

**Regra**

```sql
count(*) por janela temporal
```

**Atualização**
- query agregada por período.

**Janela Temporal**
- obrigatória por consulta, por exemplo `hoje`, `últimas 24h`, `7d` ou intervalo fechado informado.

### 5.5 Taxa de Handoff

**Status:** ✅ **IMPLEMENTED** — Endpoint `/metrics/handoff-rate`

**Definição**

Percentual de conversas que passaram de bot para humano.

**Fonte**
- eventos de handoff;
- ou registros persistidos equivalentes quando o evento estiver materializado.

**Regra**

```text
conversas com handoff bot->humano / total de conversas na mesma janela
```

**Janela Temporal**
- obrigatória por consulta e idêntica no numerador e denominador.

**Limite**
- a janela temporal e a definição do denominador precisam ser explícitas para evitar leituras inconsistentes.

### 5.6 Tasks Vencidas

**Definição**

Quantidade de tarefas com prazo expirado e ainda não resolvidas.

**Fonte**
- `tasks.due_at`;
- `tasks.status`.

**Regra**

```sql
count(*) where due_at < now() and status not in ('resolved', 'done', 'cancelled')
```

**Observação**
- a lista exata de status finais deve seguir a enumeração oficial adotada no backend.

**Janela Temporal**
- fotografia do momento atual no timezone operacional configurado.

### 5.7 Alerts Ativos

**Definição**

Quantidade de alerts não resolvidos.

**Fonte**
- `alerts.current_status`.

**Regra**

```sql
count(*) where current_status != 'resolved'
```

**Atualização**
- leitura direta do banco ou projeção equivalente.

**Janela Temporal**
- fotografia do momento atual no timezone operacional configurado.

## 6. Regras de Cálculo

### 6.1 Backend Obrigatório
- KPI deve ser calculado no backend;
- ou por query agregada controlada;
- ou por projection controlada.

### 6.2 Proibições
- frontend calcular KPI canônico;
- duplicar lógica em múltiplos lugares;
- calcular KPI a partir de payload incompleto.

### 6.3 Consistência Temporal
Toda métrica deve declarar:
- janela, por exemplo últimos 5 minutos, 24 horas ou 7 dias;
- timezone;
- regra de arredondamento quando aplicável.

## 7. Origem dos Dados
Todo KPI deve mapear explicitamente para:
- tabela;
- coluna;
- evento quando aplicável.

Se não houver origem clara, o KPI é inválido.

## 8. Atualização dos KPIs

### 8.1 Tempo Real
- via query e update incremental por realtime quando aplicável.

### 8.2 Batch Leve
- pode existir agregação por janela quando necessário para custo ou desempenho.

### 8.3 Proibição
- cache inconsistente sem invalidação clara.

## 9. Performance

### 9.1 Estratégia Inicial
- queries indexadas;
- agregação simples;
- uso preferencial do banco operacional e de índices previstos no data model.

### 9.2 Evolução Futura
- materialização;
- pré-agregação;
- cache controlado.

Regra:
- só adotar quando necessário e com definição explícita de invalidação e consistência.

## 10. Interpretação e Limites

### 10.1 KPI Não É Verdade Absoluta
Todo KPI deve ter:
- contexto;
- limite de interpretação.

Exemplo:
- tempo médio pode esconder outliers relevantes.

### 10.2 Proibições
- usar KPI sem definição formal;
- alterar cálculo sem atualizar o documento;
- comparar métricas com definição diferente.

## 11. Coerência com Outros Documentos
Este documento deve permanecer coerente com:
- `07-backend-architecture.md`;
- `08-frontend-architecture.md`;
- `09-data-model.md`;
- `10-realtime-and-events.md`;
- `12-audit-and-observability.md`;
- `18-deployment-and-runtime.md`.

## 12. Regras de Implementação
Antes de implementar qualquer KPI, query agregada, endpoint de dashboard ou componente de visualização, é obrigatório:
- verificar se já existe definição do KPI neste documento;
- verificar fonte no banco ou em eventos internos;
- verificar consistência com `09-data-model.md`;
- verificar consistência com `10-realtime-and-events.md`;
- impedir cálculo duplicado;
- impedir lógica canônica no frontend;
- impedir KPI sem owner claro no backend.

Se a origem, a janela ou a regra de cálculo ainda não estiverem definidas:
- o KPI não deve ser implementado como definitivo;
- qualquer stub temporário deve ser explicitamente isolado e documentado;
- o documento correspondente deve ser atualizado antes de consolidar o comportamento.

## 13. Regra de Precedência
Este documento orienta diretamente:
- definição de métricas;
- queries agregadas;
- endpoints de dashboard;
- exibição de KPI.

Se houver conflito entre implementação e este documento, a implementação deve ser corrigida ou este arquivo atualizado explicitamente antes de prosseguir.
