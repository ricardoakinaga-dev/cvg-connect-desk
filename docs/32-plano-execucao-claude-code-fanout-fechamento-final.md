# Plano de Execucao — Fechamento Final do Fan-Out por Consumer

**Documento:** Plano de trabalho final para validacao real do fan-out por consumer
**Data:** 2026-04-09
**Status:** Ativo
**Fonte da verdade:** `/docs`

---

## 1. Objetivo

Este documento orienta o Claude Code a concluir o tema de fan-out por consumer com evidência tecnica realmente confiavel.

O objetivo nao e mais discutir a arquitetura conceitual. O objetivo agora e:

1. validar o comportamento real do `ConsumerAwareOutboxReader`;
2. substituir validacoes "espelho de SQL" por validacao do codigo executado;
3. alinhar a documentacao final para que ela nao superestime o que foi testado.

---

## 2. Estado Atual Consolidado

Com base na auditoria do repositorio:

### 2.1 Ja Confirmado no Codigo

- `outbox_events` existe no schema e em migration.
- `outbox_consumer_acks` existe no schema e em migration.
- `ConsumerAwareOutboxReader` existe em `packages/events/src/outbox-reader.ts`.
- `message-worker`, `realtime-service` e `desk-api` usam `ConsumerAwareOutboxReader`.
- `acknowledgeWithError()` usa UPSERT, preservando `retryCount` e `lastError`.
- existem testes com PostgreSQL real via Docker.

### 2.2 O Problema Remanescente

Os testes novos melhoraram muito a confianca, mas ainda nao encerram o tema completamente porque:

- os testes principais de fan-out validam a logica por SQL manual;
- eles nao exercitam diretamente o `ConsumerAwareOutboxReader`;
- ainda falta provar que a implementacao real da classe se comporta como o SQL esperado;
- `docs/GAPS-TECNICOS.md` foi atualizado, mas precisa ficar totalmente coerente com o nivel real de evidência.

---

## 3. Fonte da Verdade Obrigatoria

O Claude Code deve ler primeiro:

1. `docs/32-plano-execucao-claude-code-fanout-fechamento-final.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/10-realtime-and-events.md`
4. `docs/09-data-model.md`
5. `docs/12-audit-and-observability.md`
6. `docs/31-relatorio-final-fanout-validacao.md`

Regras:

- Validar tudo no codigo antes de concluir.
- Se o relatorio 31 exagerar alguma claim, corrigir isso no novo relatorio final.
- Nao tratar SQL espelhado como equivalente automatico a teste da implementacao concreta.

---

## 4. Escopo Obrigatorio

### Frente A — Testar a Implementacao Real

Criar testes comportamentais que usem diretamente:

- `ConsumerAwareOutboxReader`
- `acknowledge()`
- `acknowledgeWithError()`
- `fetchPendingEvents()`
- `getConsumerAck()` se util

Esses testes devem rodar contra banco real/dev e provar o comportamento da classe, nao apenas da consulta SQL copiada.

### Frente B — Consolidar a Documentacao

Atualizar a documentacao para refletir exatamente o que foi validado:

- `docs/GAPS-TECNICOS.md`
- opcionalmente `docs/31-relatorio-final-fanout-validacao.md`, se for necessario registrar correcao factual

---

## 5. Fora de Escopo

Nao faz parte desta task:

- trocar arquitetura de outbox;
- substituir polling por broker;
- reabrir realtime auth ou webhook hardening;
- alterar frontend;
- fazer refatoracao ampla sem relacao direta com a validacao final.

---

## 6. Casos de Teste Obrigatorios

Os testes devem usar a implementacao real da classe.

### Caso 1 — Mesmo evento visivel para multiplos readers

Passos:

1. Inserir um evento em `outbox_events`.
2. Instanciar `ConsumerAwareOutboxReader` para `worker`.
3. Instanciar `ConsumerAwareOutboxReader` para `realtime`.
4. Chamar `fetchPendingEvents()` em ambos.

Criterio:

- ambos recebem o mesmo `eventId`.

### Caso 2 — Ack de um consumer nao esconde do outro

Passos:

1. Inserir um evento.
2. `workerReader.acknowledge(eventId)`.
3. Rodar `fetchPendingEvents()` em `workerReader`.
4. Rodar `fetchPendingEvents()` em `realtimeReader`.

Criterio:

- `workerReader` nao retorna mais o evento;
- `realtimeReader` ainda retorna.

### Caso 3 — Falha mantem retry para o mesmo consumer

Passos:

1. Inserir um evento.
2. `workerReader.acknowledgeWithError(eventId, 'erro')`.
3. Consultar `getConsumerAck(eventId)`.
4. Rodar `fetchPendingEvents()` para o mesmo consumer.

Criterio:

- `processedAt` continua `NULL`;
- `retryCount` aumenta;
- `lastError` fica preenchido;
- o evento continua pendente enquanto `retryCount < maxRetries`.

### Caso 4 — Falha permanente nao bloqueia outro consumer

Passos:

1. Inserir um evento.
2. Repetir `acknowledgeWithError()` no `workerReader` ate `retryCount >= maxRetries`.
3. Rodar `fetchPendingEvents()` para `workerReader`.
4. Rodar `fetchPendingEvents()` para `realtimeReader`.

Criterio:

- `workerReader` nao recebe mais o evento;
- `realtimeReader` ainda recebe.

### Caso 5 — Sucesso posterior fecha apenas aquele consumer

Passos:

1. Inserir um evento.
2. Registrar falhas no `workerReader`.
3. Chamar `workerReader.acknowledge(eventId)`.
4. Rodar `fetchPendingEvents()` para `workerReader` e `realtimeReader`.

Criterio:

- `workerReader` nao recebe mais;
- `realtimeReader` continua independente.

---

## 7. Estrategia Tecnica Esperada

### 7.1 Ambiente

Preferencia:

1. PostgreSQL real via Docker dev;
2. outro ambiente persistente real disponivel.

### 7.2 Implementacao de Teste

Os testes devem:

- importar e usar `ConsumerAwareOutboxReader`;
- preparar e limpar dados de teste no banco;
- evitar duplicar a query SQL inteira como "oraculo" principal;
- validar o resultado da classe e, quando necessario, inspecionar o banco apenas como apoio.

### 7.3 Limpeza

Cada teste deve limpar:

- `outbox_consumer_acks` dos IDs de teste;
- `outbox_events` dos IDs de teste.

---

## 8. Ajustes Documentais Obrigatorios

### 8.1 `docs/GAPS-TECNICOS.md`

Revisar e garantir:

- sem contradicoes internas;
- G-01 com status coerente com o que foi realmente testado;
- sem claims acima do que a evidência suporta;
- priorizacao executiva atualizada, se necessario.

### 8.2 `docs/31-relatorio-final-fanout-validacao.md`

Se o relatorio 31 tiver claims mais fortes que a evidência real, ajustar ou gerar novo relatorio deixando claro:

- o que foi validado por SQL manual;
- o que foi validado pela implementacao real da classe;
- o status final corrigido.

---

## 9. Criterios de Aceite

Esta task so pode ser encerrada como `PRONTO` se:

1. os cinco casos forem executados com a implementacao real do `ConsumerAwareOutboxReader`;
2. os testes passarem em ambiente persistente real;
3. a documentacao ficar coerente com a evidência;
4. nao restarem contradicoes materiais sobre G-01.

Se os testes ainda dependerem apenas de SQL espelhado, o status deve permanecer `PARCIAL`.

---

## 10. Entregavel Obrigatorio

Ao final, o Claude Code deve entregar:

1. documentos consultados;
2. estrategia de teste escolhida;
3. o que foi implementado;
4. arquivos alterados;
5. quais testes usam a classe real;
6. testes executados;
7. ambiente usado;
8. ajustes documentais feitos;
9. riscos remanescentes;
10. decisao final:
   - `PRONTO`
   - `PARCIAL`
   - `PENDENTE`

---

## 11. Instrucao Final

Leia este arquivo inteiro, depois releia os documentos da secao 3, valide o estado atual no codigo e execute a task completa.

Nao entregue apenas analise.

Implemente, teste com a classe real, atualize a documentacao e entregue um relatorio final honesto.
