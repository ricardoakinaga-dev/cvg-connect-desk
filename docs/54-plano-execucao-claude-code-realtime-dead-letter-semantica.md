# Plano de Execucao — Semantica de Dead-Letter no Realtime

Data: 2026-04-10
Status: Concluido
Escopo: Validar se o `realtime-service` deve mesmo produzir dead-letter replayavel

## 1. Objetivo

Uma mudanca recente passou a registrar dead-letter no `realtime-service` quando `processEvent()` retorna `false`.

Esse ponto precisa de auditoria arquitetural, porque:

- `false` pode significar falha terminal;
- mas tambem pode significar apenas “nenhuma projeção relevante para clientes conectados”;
- se isso for um caso valido, transformar esse retorno em dead-letter gera ruído operacional e semântica errada.

O objetivo desta task e:

- revalidar a semântica de `processEvent()` e `shouldProject()` no realtime;
- decidir se o dead-letter no realtime deve permanecer;
- corrigir a implementacao e a documentacao para refletir a decisao certa.

**Decisao final:** o `realtime-service` nao deve produzir dead-letter replayavel neste momento. `processEvent() === false` significa evento nao projetavel, nao falha terminal. O runtime agora apenas acka/ignora esses eventos para evitar ruido operacional. O padrão replayavel permanece no `message-worker`.

## 2. Fonte da Verdade Obrigatoria

Antes de qualquer alteracao, o Codex deve ler:

1. `docs/54-plano-execucao-claude-code-realtime-dead-letter-semantica.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/10-realtime-and-events.md`
4. `docs/12-audit-and-observability.md`
5. `docs/07-backend-architecture.md`
6. `docs/25-plano-testes-completo.md`
7. `docs/18-deployment-and-runtime.md`

## 3. Estado Atual a Revalidar no Codigo

O Codex deve confirmar:

- o que `processEvent()` retorna e em quais casos;
- o papel de `shouldProject()` dentro do `realtime-service`;
- se `false` representa:
  - erro,
  - evento ignorado legitimamente,
  - ausencia de subscribers,
  - ou outra semântica;
- se existe outro ponto melhor para dead-letter no realtime;
- se o helper `recordRealtimeDeadLetter` deve permanecer.

Arquivos para inspecao inicial:

- `apps/realtime-service/src/index.ts`
- `apps/realtime-service/src/dead-letter.ts`
- `packages/realtime`
- `docs/10-realtime-and-events.md`
- testes do realtime

## 4. Objetivo Tecnico da Task

Executar esta task nesta ordem:

1. auditar a semântica real do fluxo;
2. decidir se a captura atual e correta;
3. manter, ajustar ou remover a captura de dead-letter no realtime;
4. alinhar testes;
5. alinhar a documentacao.

## 5. Escopo Obrigatorio

### Frente A — Auditoria Semantica

Responder com base no codigo:

1. `processEvent() === false` significa erro terminal?
2. `shouldProject() === false` significa evento invalido ou apenas irrelevante para o realtime?
3. Um replay administrativo desse evento faz sentido operacional?

### Frente B — Correcao

Se a captura atual estiver correta:

- mantê-la;
- reforçar testes/documentação para sustentar a decisão.

Se a captura atual estiver errada:

- remover ou mover o dead-letter para um ponto semanticamente correto;
- ajustar o helper/testes/docs;
- nao manter comportamento errado so porque “ja existe”.

### Frente C — Testes

Adicionar ou ajustar testes para provar a semântica escolhida:

- comportamento de `processEvent`/projection;
- comportamento do runtime ao lidar com evento sem projeção;
- comportamento do dead-letter apenas se realmente justificável.

### Frente D — Documentacao

Atualizar no minimo:

- `docs/GAPS-TECNICOS.md`
- `docs/10-realtime-and-events.md`
- `docs/12-audit-and-observability.md`
- `docs/25-plano-testes-completo.md`

## 6. Criterios de Aceite

Esta task so pode ser considerada bem-sucedida se:

1. a semântica do realtime estiver clara e sustentada por codigo/testes;
2. o dead-letter no realtime estiver apenas onde fizer sentido real;
3. a documentacao refletir honestamente a decisao tomada.

## 7. Fora de Escopo

Nao abrir nesta task:

- redesign do realtime;
- persistencia nova da dead-letter;
- replay massivo;
- refatoracao ampla do pipeline de eventos.

## 8. Entregavel Obrigatorio

Ao final, o Codex deve entregar um relatorio contendo:

1. documentos consultados;
2. estado atual confirmado no codigo;
3. decisao arquitetural tomada;
4. o que foi implementado ou revertido;
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
2. audite a semântica do realtime;
3. corrija a implementacao se necessario;
4. ajuste testes e documentacao;
5. entregue o relatorio final no formato deste plano.
