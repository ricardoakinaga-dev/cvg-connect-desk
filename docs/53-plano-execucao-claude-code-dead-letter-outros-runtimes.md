# Plano de Execucao — Dead-Letter Replayavel em Outros Runtimes

Data: 2026-04-10
Status: Ativo
Escopo: Estender o padrao de dead-letter com `sourceEvent` para outros runtimes terminais, se fizer sentido arquitetural

## 1. Objetivo

O `message-worker` ja passou a registrar dead-letter com `sourceEvent`, tornando o replay administrativo real nesse pipeline.

O proximo passo util e verificar se outros runtimes do sistema tambem possuem falhas terminais que:

- devem gerar dead-letter;
- podem preservar o envelope original;
- podem ser reprocessadas com seguranca via replay administrativo.

O candidato principal e:

- `apps/realtime-service`

Mas esta task nao deve assumir isso sem auditoria. Primeiro e preciso validar se existe, de fato, uma fronteira terminal equivalente a do worker.

## 2. Fonte da Verdade Obrigatoria

Antes de qualquer alteracao, o Codex deve ler:

1. `docs/53-plano-execucao-claude-code-dead-letter-outros-runtimes.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/10-realtime-and-events.md`
4. `docs/12-audit-and-observability.md`
5. `docs/07-backend-architecture.md`
6. `docs/25-plano-testes-completo.md`
7. `docs/18-deployment-and-runtime.md`

## 3. Estado Atual a Revalidar no Codigo

O Codex deve confirmar:

- como o `realtime-service` consome eventos hoje;
- como lida com falhas de projection/processamento;
- se ha retry;
- se existe ponto terminal onde o evento deixa de ser processado;
- se esse ponto terminal deveria ou nao virar dead-letter;
- se existem outros runtimes alem de worker e realtime com comportamento semelhante.

Arquivos para inspecao inicial:

- `apps/realtime-service/src/index.ts`
- `apps/message-worker/src/index.ts`
- `packages/events/src/dead-letter.ts`
- `modules/admin/src/presentation/http/admin.controller.ts`
- testes de realtime e events

## 4. Objetivo Tecnico da Task

Executar esta task nesta ordem:

1. auditar os runtimes candidatos;
2. decidir quais realmente devem produzir dead-letter replayavel;
3. implementar o menor avanço seguro;
4. adicionar testes uteis;
5. atualizar a documentacao.

## 5. Escopo Obrigatorio

### Frente A — Auditoria de Runtime

Revalidar se o `realtime-service`:

- tem falha terminal real;
- deve registrar dead-letter;
- consegue preservar `sourceEvent` com semantica correta;
- nao causara ruido operacional ou duplicacao indevida se entrar no modelo.

Se a resposta for **nao**, registrar isso com clareza e nao inventar comportamento.

### Frente B — Implementacao Segura

Se existir runtime adicional elegivel:

- implementar helper equivalente ao do worker;
- registrar dead-letter com `sourceEvent`;
- manter o replay administrativo compativel com o envelope salvo;
- evitar mudar a semantica central do runtime so para “forcar” dead-letter.

### Frente C — Testes

Adicionar evidencia util:

- teste do helper/runtime novo, se existir;
- teste do fluxo terminal -> dead-letter -> `sourceEvent`;
- evitar testes apenas estruturais como unica prova.

### Frente D — Documentacao

Atualizar no minimo:

- `docs/GAPS-TECNICOS.md`
- `docs/10-realtime-and-events.md`
- `docs/12-audit-and-observability.md`
- `docs/25-plano-testes-completo.md`

## 6. Criterios de Aceite

Esta task so pode ser considerada bem-sucedida se:

1. houver uma decisao arquitetural clara sobre quais runtimes adicionais devem ou nao produzir dead-letter replayavel;
2. se houver implementacao, ela preservar `sourceEvent` de forma consistente;
3. houver cobertura minima de teste para o avanço;
4. a documentacao refletir honestamente o estado final.

## 7. Fora de Escopo

Nao abrir nesta task:

- persistencia duravel da dead-letter;
- replay em lote;
- redesign do realtime;
- novos mecanismos de fila/broker.

## 8. Entregavel Obrigatorio

Ao final, o Codex deve entregar um relatorio contendo:

1. documentos consultados;
2. estado atual confirmado no codigo;
3. decisao arquitetural tomada;
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
2. audite os runtimes candidatos;
3. implemente apenas o avanço seguro e justificado;
4. teste o que for viavel;
5. atualize a documentacao;
6. entregue o relatorio final no formato deste plano.
