# Plano de Execucao — Claude Code

**Documento:** Plano de execucao para fechar o tema de eventos interprocesso e fan-out por consumer
**Data:** 2026-04-09
**Status:** Ativo
**Fonte da verdade:** `/docs`

---

## 1. Objetivo

Este documento existe para servir como instrucao unica de execucao para o Claude Code.

O objetivo e concluir, com base no estado real do repositorio e na documentacao oficial em `/docs`, o fechamento tecnico do pipeline de eventos com:

- outbox persistido;
- fan-out por consumer;
- retry semantico por consumer;
- validacao comportamental real;
- documentacao final coerente com o codigo.

Este plano foi consolidado a partir da documentacao oficial e das auditorias recentes do projeto.

---

## 2. Fonte da Verdade Obrigatoria

Antes de qualquer mudanca, o Claude Code deve ler e seguir estes documentos:

1. `docs/GAPS-TECNICOS.md`
2. `docs/10-realtime-and-events.md`
3. `docs/09-data-model.md`
4. `docs/12-audit-and-observability.md`
5. `docs/18-deployment-and-runtime.md`
6. `docs/26-relatorio-analise-documentacao-vs-implementacao.md`
7. `docs/27-relatorio-executivo-rastreabilidade-documentacao-vs-codigo.md`
8. `docs/29-auditoria-paralela-seguranca-aderencia.md`
9. `docs/29-relatorio-final-autenticacao-realtime.md`

Regras:

- Em caso de conflito entre suposicao e documentacao, a documentacao prevalece.
- Em caso de conflito entre documentacao historica e codigo atual, validar no codigo e registrar a divergencia.
- Nao assumir que relatorios antigos continuam corretos sem revalidacao.

---

## 3. Estado Atual Consolidado

Com base na documentacao e no codigo auditado, o estado atual deve ser entendido assim:

### 3.1 Ja Implementado

- `outbox_events` existe no schema e em migration.
- `outbox_consumer_acks` existe no schema e em migration.
- `databaseEventPublisher` publica no banco.
- `ConsumerAwareOutboxReader` existe.
- `message-worker` usa `ConsumerAwareOutboxReader`.
- `realtime-service` usa `ConsumerAwareOutboxReader`.
- `desk-api` usa `ConsumerAwareOutboxReader` no endpoint `/events`.
- `acknowledgeWithError()` hoje usa UPSERT, mantendo `processedAt = NULL`, `retryCount` e `lastError`.

### 3.2 Ainda Nao Fechado

O principal ponto remanescente nao e mais a arquitetura do outbox em si, mas a falta de **evidencia comportamental real** de que o fan-out funciona de verdade contra estado persistido.

Hoje ainda existe um problema de confianca:

- muitos testes do tema continuam estruturais;
- varias afirmacoes ja foram dadas como "prontas" sem prova comportamental;
- `docs/GAPS-TECNICOS.md` ficou parcialmente contraditorio e precisa consolidacao final.

---

## 4. Objetivo da Task

O Claude Code deve executar uma task unica com dois resultados finais:

1. Criar **testes comportamentais reais** para validar fan-out por consumer contra banco/estado persistido.
2. Atualizar a documentacao para refletir o resultado verdadeiro desses testes.

O foco desta task e encerrar o tema com evidencia concreta, e nao apenas com leitura estrutural de codigo.

---

## 5. Escopo Obrigatorio

### 5.1 Frente A — Validacao Comportamental Real

Implementar testes que provem, em comportamento real:

1. O mesmo evento e visivel para multiplos consumers independentes.
2. O ack de um consumer nao esconde o evento para outro.
3. A falha de um consumer mantem retry apenas para aquele consumer.
4. Uma falha permanente de um consumer nao bloqueia outro consumer.
5. Sucesso posterior encerra apenas o consumer que reconheceu o evento.

### 5.2 Frente B — Consolidacao Documental

Ao final dos testes reais:

- revisar `docs/GAPS-TECNICOS.md`;
- remover contradicoes internas;
- marcar G-01 corretamente como:
  - `mitigado/concluido`, se os testes reais provarem o comportamento;
  - `parcial`, se ainda faltar algo relevante;
- ajustar `docs/10-realtime-and-events.md` e `docs/18-deployment-and-runtime.md` apenas se houver necessidade real de alinhamento adicional.

---

## 6. Fora de Escopo

Esta task **nao deve**:

- reescrever toda a arquitetura de eventos;
- trocar outbox por Redis, Kafka ou outro broker;
- refatorar modulos sem necessidade direta;
- inventar novos requisitos fora de `/docs`;
- alterar o frontend sem necessidade;
- reabrir os temas de realtime auth ou webhook hardening, salvo regressao descoberta.

---

## 7. Arquivos a Inspecionar Primeiro

O Claude Code deve inspecionar primeiro estes arquivos:

### 7.1 Banco e Schema

- `packages/database/src/schema.ts`
- `packages/database/supabase/migrations/0010_outbox_events.sql`
- `packages/database/supabase/migrations/0011_outbox_consumer_acks.sql`

### 7.2 Eventos

- `packages/events/src/outbox-publisher.ts`
- `packages/events/src/outbox-reader.ts`
- `packages/events/src/envelope.ts`

### 7.3 Consumidores

- `apps/message-worker/src/index.ts`
- `apps/realtime-service/src/index.ts`
- `apps/desk-api/src/index.ts`

### 7.4 Testes

- `packages/events/src/__tests__/outbox.test.ts`
- qualquer helper de banco/teste reutilizavel no monorepo

---

## 8. Casos de Teste Obrigatorios

Os testes reais devem cobrir no minimo estes cenarios:

### Caso 1 — Mesmo evento visivel para multiplos consumers

Passos:

1. Inserir um evento em `outbox_events`.
2. Instanciar reader de `worker`.
3. Instanciar reader de `realtime`.
4. Confirmar que ambos enxergam o mesmo evento pendente.

Criterio de aceite:

- `worker.fetchPendingEvents()` retorna o evento.
- `realtime.fetchPendingEvents()` tambem retorna o mesmo evento.

### Caso 2 — Ack de um consumer nao esconde para outro

Passos:

1. Inserir um evento.
2. `worker.acknowledge(eventId)`.
3. Buscar pendentes para `worker`.
4. Buscar pendentes para `realtime`.

Criterio de aceite:

- `worker` nao deve mais ver o evento.
- `realtime` ainda deve ver o evento.

### Caso 3 — Falha de um consumer mantem retry para ele

Passos:

1. Inserir um evento.
2. `worker.acknowledgeWithError(eventId, 'erro')`.
3. Buscar pendentes para `worker` com `retryCount < maxRetries`.

Criterio de aceite:

- o evento continua pendente para `worker`;
- `retryCount` aumenta;
- `lastError` fica preservado;
- `processedAt` continua `NULL`.

### Caso 4 — Falha permanente para um consumer nao bloqueia outro

Passos:

1. Inserir um evento.
2. Repetir falha do `worker` ate `retryCount >= maxRetries`.
3. Buscar pendentes para `worker`.
4. Buscar pendentes para `realtime`.

Criterio de aceite:

- `worker` nao deve mais receber o evento;
- `realtime` ainda deve receber o evento normalmente.

### Caso 5 — Sucesso posterior encerra apenas aquele consumer

Passos:

1. Inserir um evento.
2. Registrar uma ou mais falhas para `worker`.
3. Executar `worker.acknowledge(eventId)`.
4. Buscar pendentes novamente para `worker` e `realtime`.

Criterio de aceite:

- `worker` deixa de ver o evento;
- `realtime` permanece independente, se ainda nao tiver reconhecido.

---

## 9. Estrategia de Teste Esperada

O Claude Code deve preferir esta ordem:

1. banco real de desenvolvimento isolado;
2. banco de teste confiavel ja existente no projeto;
3. outro mecanismo persistente real disponivel no monorepo.

Regras:

- Evitar mocks puros para essa validacao.
- Nao apresentar `toContain(...)` como evidência comportamental.
- Se for necessario criar helper de setup/cleanup, fazer isso de forma minima, segura e reutilizavel.

Se houver uso de ambiente real/dev:

- registrar ambiente utilizado;
- registrar comandos executados;
- registrar limpeza antes/depois;
- registrar qualquer limitacao.

---

## 10. Criterios de Aceite Tecnicos

A task so pode ser considerada fechada se, ao final:

1. houver testes reais cobrindo os cinco casos obrigatorios;
2. esses testes tiverem sido executados de fato;
3. a documentacao refletir o resultado real desses testes;
4. o status final do tema fan-out estiver justificado por evidencia, nao por inferencia.

Se algum item falhar:

- nao marcar como `PRONTO`;
- registrar claramente como `PARCIAL`;
- listar o que ficou faltando.

---

## 11. Ajustes Documentais Obrigatorios

Ao final da execucao, revisar e ajustar:

### 11.1 `docs/GAPS-TECNICOS.md`

Fazer obrigatoriamente:

- remover contradicoes internas;
- alinhar a secao de G-01 com o resultado verdadeiro;
- atualizar priorizacao executiva, se necessario;
- manter apenas o estado tecnico realmente sustentado por teste.

### 11.2 `docs/10-realtime-and-events.md`

Atualizar somente se os testes confirmarem algo relevante sobre:

- modelo real de fan-out;
- estrategia de retry por consumer;
- papel de `http-poll`, `worker` e `realtime` como consumers independentes.

### 11.3 `docs/18-deployment-and-runtime.md`

Atualizar apenas se a execucao mostrar algum ponto operacional novo:

- dependencia de migration obrigatoria;
- necessidade de banco alinhado;
- observacao relevante para runtime real.

---

## 12. Formato de Entrega Obrigatorio

Ao final da task, o Claude Code deve entregar um relatorio com esta estrutura:

### 12.1 Documentos Consultados

Listar exatamente quais docs em `/docs` foram usados.

### 12.2 Estrategia de Teste Escolhida

Informar:

- tipo de ambiente usado;
- motivo da escolha;
- limitacoes.

### 12.3 O Que Foi Implementado

Descrever:

- testes novos;
- helpers criados;
- eventuais pequenos ajustes de codigo, se houver.

### 12.4 Arquivos Alterados

Listar todos os arquivos modificados ou criados.

### 12.5 Casos Comportamentais Cobertos

Mapear cada caso obrigatorio para o teste correspondente.

### 12.6 Testes Executados

Informar:

- comandos executados;
- suites rodadas;
- o que passou;
- o que nao foi possivel executar.

### 12.7 Ambiente Utilizado

Informar:

- local/dev container/postgres/docker;
- variaveis relevantes;
- migrations necessarias.

### 12.8 Ajustes na Documentacao

Informar:

- quais docs foram ajustados;
- o que foi corrigido;
- qual passou a ser o status final de G-01.

### 12.9 Riscos Remanescentes

Listar apenas os riscos que realmente continuarem existindo.

### 12.10 Decisao Final

Classificar o tema como:

- `PRONTO`
- `PARCIAL`
- `PENDENTE`

e justificar com base no que foi efetivamente testado.

---

## 13. Criterio de Honestidade

Este plano exige explicitamente:

- nao inflar conclusao;
- nao chamar teste estrutural de teste comportamental;
- nao marcar item como pronto sem evidência executada;
- nao ocultar bloqueios de ambiente;
- nao usar documentacao antiga como prova final sem validar no codigo.

---

## 14. Resultado Esperado

Ao final desta task, deve existir:

1. evidência concreta de comportamento real do fan-out por consumer;
2. documentacao coerente com o estado real do codigo;
3. uma decisao final sustentada tecnicamente;
4. um ponto de partida seguro para as proximas tasks do projeto.

---

## 15. Instrucao Final ao Claude Code

Leia este documento por inteiro, depois leia os documentos de `/docs` listados na secao 2, valide no codigo o estado atual e execute a task completa.

Nao entregue apenas analise. Implemente, teste, valide e atualize a documentacao ao final.
