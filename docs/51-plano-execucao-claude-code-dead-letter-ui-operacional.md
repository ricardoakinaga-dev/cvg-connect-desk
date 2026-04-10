# Plano de Execucao — Dead-Letter UI Operacional

Data: 2026-04-10
Status: Ativo
Escopo: Reduzir o gap G-05 com uma UI minima de operacao para dead-letter

## 1. Objetivo

Depois dos avancos em eventos, HTTP/API, Secretary e smoke E2E, o proximo gap funcional mais util na `/docs` e:

- expor dead-letters de forma operacional no admin;
- reduzir dependencia de curl e inspecao manual;
- permitir ao time visualizar e agir sobre falhas com menor atrito.

O projeto ja possui:

- `deadLetterStore` em `packages/events/src/dead-letter.ts`;
- endpoint `GET /admin/dead-letters` em `apps/desk-api/src/app.ts`;
- gap G-05 documentado em `docs/GAPS-TECNICOS.md`.

Esta task deve fechar o maior pedaco seguro desse gap.

## 2. Fonte da Verdade Obrigatoria

Antes de qualquer alteracao, o Codex deve ler:

1. `docs/51-plano-execucao-claude-code-dead-letter-ui-operacional.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/12-audit-and-observability.md`
4. `docs/10-realtime-and-events.md`
5. `docs/07-backend-architecture.md`
6. `docs/25-plano-testes-completo.md`
7. `docs/18-deployment-and-runtime.md`

## 3. Estado Atual que Deve Ser Revalidado no Codigo

O Codex deve confirmar:

- como `deadLetterStore` funciona hoje;
- quais campos cada entrada possui;
- se existe apenas listagem, ou tambem stats e acao manual;
- onde fica a pagina/painel de admin no `desk-web`;
- se o `desk-web` ja tem client/helper para `/admin/dead-letters`;
- se ha permissao/guard especifico para operacoes administrativas.

Arquivos para inspecao inicial:

- `packages/events/src/dead-letter.ts`
- `packages/events/src/index.ts`
- `apps/desk-api/src/app.ts`
- `apps/desk-web/src/lib/api.ts`
- `apps/desk-web/src/pages/Admin.tsx`
- testes relacionados a admin, events e observability

## 4. Objetivo Tecnico da Task

Executar esta task nesta ordem:

1. revalidar o contrato atual de dead-letter;
2. definir o menor contrato operacional faltante;
3. implementar backend faltante, se necessario;
4. implementar UI minima no admin;
5. adicionar testes uteis;
6. atualizar a documentacao.

## 5. Escopo Obrigatorio

### Frente A — Contrato Backend

O Codex deve confirmar se hoje existe:

- listagem de dead-letters;
- filtro por status/resolved;
- stats agregados;
- retry manual;
- resolve/manual dismiss.

Se faltar uma acao operacional minima, implementar o menor contrato seguro necessario.

Preferencia de escopo:

1. `GET /admin/dead-letters` com dados suficientes para a UI
2. `POST /admin/dead-letters/:id/retry` ou acao equivalente
3. opcionalmente `POST /admin/dead-letters/:id/resolve` se isso fizer mais sentido que retry

Nao inventar replay massivo nem fila complexa.

### Frente B — UI Minima no Admin

Implementar uma interface simples e operacional em `desk-web` para:

- listar dead-letters;
- mostrar event type, erro, data, retry count e estado basico;
- exibir stats simples, se o endpoint ja devolver;
- permitir retry/manual action para uma entrada;
- refletir loading, sucesso e falha de forma clara.

A UI deve:

- ser utilitaria;
- manter baixo custo de manutencao;
- respeitar o estilo atual do admin;
- evitar overdesign.

### Frente C — Testes

Adicionar o minimo de evidencia util:

- teste de integracao HTTP/API para listagem;
- teste de integracao HTTP/API para retry/manual action, se criada;
- teste de frontend/componente ou smoke simples cobrindo o carregamento da lista e a chamada da acao;
- evitar testes puramente estruturais como unica evidencia.

### Frente D — Documentacao

Atualizar no minimo:

- `docs/GAPS-TECNICOS.md`
- `docs/25-plano-testes-completo.md`
- `docs/18-deployment-and-runtime.md`

Se necessario:

- `docs/12-audit-and-observability.md`
- `e2e/README.md`

## 6. Criterios de Aceite

Esta task so pode ser considerada bem-sucedida se:

1. existir uma forma visual de consultar dead-letters no admin;
2. existir uma acao manual minima clara e implementada, ou o motivo tecnico para nao implementa-la estiver explicitado;
3. houver cobertura minima de teste para o que foi entregue;
4. a documentacao refletir o novo estado real.

## 7. Fora de Escopo

Nao abrir nesta task:

- replay massivo;
- dashboard analitico completo;
- observabilidade enterprise completa;
- refatoracao ampla do painel admin;
- novo sistema de filas.

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
3. implemente a UI operacional minima de dead-letter;
4. adicione o backend faltante, se necessario;
5. teste o que for viavel;
6. atualize a documentacao;
7. entregue o relatorio final no formato deste plano.
