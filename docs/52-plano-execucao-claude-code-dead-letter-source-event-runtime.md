# Plano de Execucao — Dead-Letter com Source Event em Runtime

Data: 2026-04-10
Status: Ativo
Escopo: Transformar o retry de dead-letter em caminho efetivo de replay em runtime

## 1. Objetivo

O projeto ja avancou em `G-05` com:

- listagem operacional de dead-letters no admin;
- acoes de `retry` e `resolve`;
- UI minima no `desk-web`.

Porem, o proprio estado atual do codigo mostra um gap residual importante:

- o `retry` automatico depende de `sourceEvent`;
- o pipeline real de falhas ainda nao garante que esse `sourceEvent` seja salvo em todas as entradas da dead-letter;
- sem isso, o replay fica parcial e muitas entradas continuam limitadas a `resolve` manual.

O objetivo desta task e:

- popular `sourceEvent` automaticamente quando eventos falham e vao para dead-letter;
- garantir que o replay administrativo reutilize esse envelope salvo;
- deixar o retry contextual realmente funcional em runtime.

## 2. Fonte da Verdade Obrigatoria

Antes de qualquer alteracao, o Codex deve ler:

1. `docs/52-plano-execucao-claude-code-dead-letter-source-event-runtime.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/10-realtime-and-events.md`
4. `docs/12-audit-and-observability.md`
5. `docs/07-backend-architecture.md`
6. `docs/25-plano-testes-completo.md`
7. `docs/18-deployment-and-runtime.md`

## 3. Estado Atual que Deve Ser Revalidado no Codigo

O Codex deve confirmar no codigo:

- onde as falhas de processamento sao capturadas hoje;
- onde `deadLetterStore.add(...)` e chamado;
- se o envelope original esta disponivel nesse ponto;
- quais handlers/workers/realtime flows enviam eventos para dead-letter;
- como o `retry` em `modules/admin` republica `sourceEvent` no outbox;
- quais casos hoje chegam a dead-letter sem `sourceEvent`.

Arquivos para inspecao inicial:

- `packages/events/src/dead-letter.ts`
- `packages/events/src/outbox-reader.ts`
- `apps/message-worker/src/index.ts`
- `apps/realtime-service/src/index.ts`
- `modules/admin/src/presentation/http/admin.controller.ts`
- testes de `events`, `message-worker`, `realtime-service` e admin dead-letter

## 4. Objetivo Tecnico da Task

Executar esta task nesta ordem:

1. mapear os pontos reais de entrada em dead-letter;
2. garantir que o envelope/evento original seja preservado;
3. popular `sourceEvent` automaticamente no store;
4. validar que o retry usa esse `sourceEvent` salvo;
5. adicionar testes comportamentais;
6. atualizar a documentacao.

## 5. Escopo Obrigatorio

### Frente A — Captura de Source Event

Implementar a menor mudanca segura para que entradas de dead-letter recebam automaticamente o envelope de origem quando ele existir.

Requisito:

- se um consumer falhar ao processar um evento do outbox, a entrada da dead-letter deve guardar contexto suficiente para replay;
- esse contexto deve ser o mais proximo possivel do envelope real republicavel.

### Frente B — Retry Runtime

Garantir que o retry administrativo:

- reaproveite o `sourceEvent` salvo;
- republique corretamente no outbox;
- marque a entrada como resolvida apenas quando o replay for aceito;
- mantenha comportamento previsivel para entradas antigas sem `sourceEvent`.

### Frente C — Testes

Adicionar evidencia util, preferencialmente comportamental:

- teste do pipeline de falha -> dead-letter com `sourceEvent`;
- teste do retry usando entrada criada pelo fluxo real;
- se viavel, teste integrado entre consumer e admin retry;
- evitar depender apenas de testes estruturais.

### Frente D — Documentacao

Atualizar no minimo:

- `docs/GAPS-TECNICOS.md`
- `docs/25-plano-testes-completo.md`
- `docs/12-audit-and-observability.md`

Se necessario:

- `docs/10-realtime-and-events.md`
- `docs/18-deployment-and-runtime.md`

## 6. Criterios de Aceite

Esta task so pode ser considerada bem-sucedida se:

1. falhas reais passarem a gravar `sourceEvent` automaticamente no dead-letter;
2. o retry administrativo funcionar com esse contexto salvo;
3. houver teste minimamente convincente do fluxo;
4. a documentacao refletir com honestidade o novo estado.

## 7. Fora de Escopo

Nao abrir nesta task:

- persistencia em banco da dead-letter;
- replay massivo em lote;
- dashboard de observabilidade avancado;
- redesign amplo da UI admin.

## 8. Entregavel Obrigatorio

Ao final, o Codex deve entregar um relatorio contendo:

1. documentos consultados;
2. estado atual confirmado no codigo;
3. estrategia escolhida;
4. o que foi implementado;
5. arquivos alterados;
6. testes adicionados/executados;
7. riscos remanescentes;
8. decisao final:
   - `PRONTO`
   - `PARCIAL`
   - `PENDENTE`

## 9. Instrucao Final

Leia este documento inteiro antes de qualquer alteracao.

Depois:

1. leia os documentos obrigatorios;
2. valide o estado atual no codigo;
3. implemente a captura automatica de `sourceEvent`;
4. valide o retry administrativo sobre esse fluxo real;
5. adicione testes uteis;
6. atualize a documentacao;
7. entregue o relatorio final no formato deste plano.
