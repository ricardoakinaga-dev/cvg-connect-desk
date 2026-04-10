# Plano de Execucao — Event Version no Envelope

Data: 2026-04-10
Status: Ativo
Escopo: Atacar o gap G-07 com versionamento explicito do envelope de eventos

## 1. Objetivo

O projeto ja possui pipeline de eventos com:

- publisher no banco;
- fan-out por consumer;
- retry semântico;
- replay contextual para dead-letter em pontos terminais apropriados.

O gap residual G-07 e:

- o envelope de eventos nao possui `event_version` explicito;
- consumers dependem implicitamente da estrutura atual do payload;
- isso dificulta evolucao segura do contrato de eventos.

O objetivo desta task e:

- introduzir `event_version` no envelope de eventos;
- propagar esse campo pelos pontos centrais do pipeline;
- manter compatibilidade razoavel com o estado atual do projeto.

## 2. Fonte da Verdade Obrigatoria

Antes de qualquer alteracao, o Codex deve ler:

1. `docs/55-plano-execucao-claude-code-event-version-envelope.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/10-realtime-and-events.md`
4. `docs/09-data-model.md`
5. `docs/12-audit-and-observability.md`
6. `docs/07-backend-architecture.md`
7. `docs/25-plano-testes-completo.md`

## 3. Estado Atual a Revalidar no Codigo

O Codex deve confirmar:

- como o envelope e definido hoje;
- se existe campo `version` apenas em partes do pipeline;
- como `outbox_events` persiste versao hoje;
- como `toEventEnvelope()` e os publishers montam o envelope;
- quais consumers dependem diretamente do formato atual.

Arquivos para inspecao inicial:

- `packages/events/src/envelope.ts`
- `packages/events/src/outbox-publisher.ts`
- `packages/events/src/outbox-reader.ts`
- `packages/events/src/publisher.ts`
- `packages/database/src/schema.ts`
- `apps/message-worker/src/index.ts`
- `apps/realtime-service/src/index.ts`

## 4. Objetivo Tecnico da Task

Executar esta task nesta ordem:

1. revalidar o contrato atual do envelope;
2. definir a menor mudanca segura para versionamento explicito;
3. implementar no core de eventos;
4. propagar para leitura, publicacao e replay;
5. ajustar testes;
6. atualizar a documentacao.

## 5. Escopo Obrigatorio

### Frente A — Contrato do Envelope

Definir de forma explicita:

- nome final do campo (`event_version` ou equivalente consistente);
- tipo;
- valor default para eventos atuais;
- relacao com o campo `version` ja existente no outbox, se aplicavel.

Preferencia:

- evitar ambiguidade entre “versao do aggregate” e “versao do contrato do evento”;
- se necessario, manter ambos com nomes distintos.

### Frente B — Propagacao no Pipeline

Garantir que o versionamento apareca de forma consistente em:

- publisher;
- outbox reader;
- envelope exportado;
- dead-letter replay context, se afetado;
- worker e realtime, se precisarem do tipo atualizado.

### Frente C — Compatibilidade

Evitar quebrar o sistema desnecessariamente.

Se houver risco de breaking change:

- aplicar fallback/default seguro;
- documentar claramente;
- ajustar os tipos sem espalhar refatoracao excessiva.

### Frente D — Testes

Adicionar ou ajustar testes para provar:

- envelope com versao explicita;
- leitura/publicacao preservando o campo;
- replay/dead-letter nao perdendo a versao;
- compatibilidade minima com o pipeline atual.

### Frente E — Documentacao

Atualizar no minimo:

- `docs/GAPS-TECNICOS.md`
- `docs/10-realtime-and-events.md`
- `docs/12-audit-and-observability.md`
- `docs/25-plano-testes-completo.md`

Se necessario:

- `docs/09-data-model.md`

## 6. Criterios de Aceite

Esta task so pode ser considerada bem-sucedida se:

1. o envelope passar a ter versionamento explicito;
2. o campo estiver propagado pelos pontos centrais do pipeline;
3. houver cobertura minima de teste para a mudanca;
4. a documentacao refletir honestamente o novo contrato.

## 7. Fora de Escopo

Nao abrir nesta task:

- redesign completo dos schemas de payload;
- versionamento por migration de todos os eventos historicos;
- broker novo;
- refatoracao ampla de todos os consumers alem do necessario.

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
2. valide o contrato atual no codigo;
3. implemente o versionamento explicito do envelope;
4. propague a mudanca com o menor breaking change possivel;
5. ajuste testes e documentacao;
6. entregue o relatorio final no formato deste plano.
