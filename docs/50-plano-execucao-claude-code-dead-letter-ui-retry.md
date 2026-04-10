# Plano de Execucao — Dead-Letter UI e Retry Manual

Data: 2026-04-10
Status: Ativo
Escopo: Atacar o proximo gap funcional de baixa severidade com alto valor operacional

## 1. Objetivo

O projeto ja possui:

- mecanismo de dead-letter em `packages/events/src/dead-letter.ts`;
- endpoint `/admin/dead-letters` exposto na API;
- documentacao reconhecendo que a operacao existe, mas sem interface.

O proximo passo desta trilha e:

- criar uma UI minima para visualizacao de dead-letters;
- permitir retry manual ou, no minimo, operacao assistida;
- reduzir dependencia de curl/acesso direto ao banco durante incidentes.

## 2. Fonte da Verdade Obrigatoria

Antes de qualquer alteracao, o Claude Code deve ler:

1. `docs/50-plano-execucao-claude-code-dead-letter-ui-retry.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/12-audit-and-observability.md`
4. `docs/07-backend-architecture.md`
5. `docs/10-realtime-and-events.md`
6. `docs/25-plano-testes-completo.md`
7. `docs/18-deployment-and-runtime.md`

## 3. Estado Atual Esperado

O Claude Code deve confirmar no codigo:

- `packages/events/src/dead-letter.ts` existe e como a store funciona;
- `/admin/dead-letters` existe em `apps/desk-api/src/app.ts`;
- qual pagina Admin atual existe em `apps/desk-web`;
- se ja ha client/API helper para esse endpoint;
- se existe ou nao endpoint de retry/manual resolve alem do list/get stats.

## 4. Objetivo Tecnico da Task

Executar esta task nesta ordem:

1. revalidar o contrato atual de dead-letter;
2. decidir o menor escopo seguro de UI operacional;
3. implementar a rota/API client faltante, se necessario;
4. implementar a interface minima no admin;
5. adicionar testes apropriados;
6. atualizar a documentacao.

## 5. Escopo Obrigatorio

### Frente A — Contrato Operacional

Confirmar o que hoje existe:

- listagem de dead-letters;
- stats;
- campos disponiveis por entrada;
- se existe resolve/retry;
- se falta endpoint para acao manual.

Se faltar endpoint minimo para operacao manual, o Claude Code deve implementar o menor contrato seguro necessario.

### Frente B — UI Minima de Admin

Implementar uma interface simples em `desk-web` para:

- listar entradas de dead-letter;
- exibir status basico, tipo de evento, erro, timestamps;
- permitir filtro simples, se couber;
- permitir retry manual ou acao equivalente, se suportada pelo backend.

A UI deve ser:

- utilitaria;
- clara;
- barata de manter;
- consistente com o estilo atual do admin.

### Frente C — Testes

Adicionar o minimo de validacao util:

- teste de integracao/API para a operacao de retry, se for criada;
- teste de componente ou smoke simples da UI, se viavel;
- validacao de que a listagem consome o endpoint correto.

### Frente D — Documentacao

Atualizar, no minimo:

- `docs/GAPS-TECNICOS.md`
- `docs/25-plano-testes-completo.md`
- `docs/18-deployment-and-runtime.md`

Se necessario:

- `docs/12-audit-and-observability.md`

## 6. Critérios de Aceite

Esta task so pode ser considerada bem-sucedida se:

1. houver uma forma visual de consultar dead-letters no admin;
2. a operacao manual minima estiver clara e documentada;
3. existir cobertura minima de teste para a parte implementada;
4. a documentacao refletir o novo estado real.

## 7. Fora de Escopo

Nao abrir nesta task:

- dashboard complexo de observabilidade;
- sistema completo de replay massivo;
- refatoracao grande do painel admin;
- automacoes de incident response amplas.

## 8. Arquivos a Inspecionar Primeiro

- `packages/events/src/dead-letter.ts`
- `apps/desk-api/src/app.ts`
- `apps/desk-web/src/pages/Admin.tsx`
- `apps/desk-web/src/lib/api.ts`
- testes relacionados a admin e events

## 9. Entregavel Obrigatorio

Ao final, o Claude Code deve entregar um relatorio contendo:

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

## 10. Instrucao Final

Leia este documento inteiro antes de qualquer alteracao.

Depois:

1. leia os documentos obrigatorios;
2. valide no codigo o estado atual;
3. implemente a UI operacional minima de dead-letter;
4. adicione o backend faltante, se necessario;
5. teste o que for viavel;
6. atualize a documentacao;
7. entregue o relatorio final no formato deste plano.
