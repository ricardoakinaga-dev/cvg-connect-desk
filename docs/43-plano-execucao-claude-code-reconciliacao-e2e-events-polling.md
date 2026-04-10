# Plano de Execucao — Reconciliacao E2E, Events Polling e Execucao Reproduzivel

Data: 2026-04-10
Status: Ativo
Escopo: Corrigir inconsistencias entre documentacao, testes e implementacao real antes de considerar a trilha E2E/API estabilizada

## 1. Objetivo

Este plano existe para atacar tres inconsistencias reais do projeto:

1. reconciliar a documentacao de testes/E2E com o estado atual do codigo;
2. restaurar ou substituir a cobertura de `events polling`;
3. deixar a trilha Playwright pronta para execucao reproduzivel por outra pessoa do time.

O objetivo nao e abrir novas frentes amplas. O objetivo e consolidar a verdade do repositorio e reduzir ambiguidades operacionais.

## 2. Fonte da Verdade Obrigatoria

Antes de qualquer alteracao, o Claude Code deve ler:

1. `docs/43-plano-execucao-claude-code-reconciliacao-e2e-events-polling.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/25-plano-testes-completo.md`
4. `docs/19-test-strategy.md`
5. `docs/16-validation-checklist.md`
6. `docs/39-plano-execucao-claude-code-playwright-smoke.md`
7. `docs/42-plano-execucao-claude-code-playwright-smoke-finalizacao-g06.md`

Regras:

- validar no codigo o estado atual antes de alterar documentacao;
- se um teste foi removido ou mudou de papel, a documentacao deve refletir isso;
- se um endpoint mudou de implementacao, os testes estruturais e docs devem refletir o comportamento real.

## 3. Problemas Ja Identificados

### 3.1 Documentacao de E2E parcialmente desalinhada

Hoje existem smoke tests em:

- `e2e/smoke/login-flow.test.ts`
- `e2e/smoke/inbox-authenticated.test.ts`
- `e2e/smoke/create-task.test.ts`
- `e2e/smoke/kanban.test.ts`

Mas ainda ha trechos em `/docs` e relatorios anteriores que falam em:

- `send-message.test.ts` inexistente;
- nomenclaturas antigas;
- status de E2E que mistura "configurado", "implementado" e "executado".

### 3.2 Cobertura de `events polling` ficou inconsistente

O repositório tinha evidencia anterior de `events-polling.integration.test.ts`, mas o arquivo nao esta mais presente em `apps/desk-api/src/__tests__/`.

Ao mesmo tempo:

- `apps/desk-api/src/app.ts` ainda expõe `/events` com `ConsumerAwareOutboxReader`;
- alguns testes estruturais foram alterados para focar em `deadLetterStore` de `/admin/dead-letters`;
- a documentacao continua citando `events polling tests` como entregues.

O Claude Code precisa verificar:

- se a cobertura correta de `/events` foi perdida;
- se foi substituida por algo equivalente;
- ou se precisa ser restaurada.

### 3.3 Execucao Playwright ainda precisa ficar reproduzivel

Ja existem:

- `playwright.config.ts`
- `e2e/README.md`
- `e2e/support/start-e2e-stack.ts`

Mas ainda ha risco de execucao nao reproduzivel se:

- a documentacao nao explicar o compose correto;
- os pre-requisitos nao estiverem claros;
- os dados seeded/admin nao estiverem descritos;
- o comando real falhar para outra pessoa sem contexto.

## 4. Objetivo Tecnico da Task

O Claude Code deve executar esta task nesta ordem:

1. revalidar o estado atual do Playwright e dos testes de API relacionados a `/events`;
2. corrigir a documentacao de testes/E2E;
3. restaurar ou substituir a cobertura real de `events polling`;
4. endurecer a trilha de execucao Playwright para outra pessoa conseguir rodar;
5. documentar o estado final com honestidade.

## 5. Escopo Obrigatorio

### Frente A — Reconciliacao Documental de E2E

Revisar e corrigir, no minimo:

- `docs/GAPS-TECNICOS.md`
- `docs/25-plano-testes-completo.md`
- `docs/19-test-strategy.md`
- `docs/16-validation-checklist.md`

O resultado esperado:

- nomes corretos dos arquivos Playwright;
- status coerente de "configurado", "implementado" e "executado";
- remocao de referencias a arquivos inexistentes;
- descricao honesta do que a camada E2E cobre hoje.

### Frente B — Restaurar ou Substituir `events polling`

O Claude Code deve descobrir qual e a verdade atual para a rota `/events`:

- ainda existe e usa `ConsumerAwareOutboxReader`?
- ainda e relevante para o `realtime-service`?
- continua sendo rota critica que merece teste de integracao?

Depois disso, deve fazer uma destas duas coisas:

1. **Restaurar** um teste de integracao real para `/events`, se a rota continuar critica;
2. **Substituir oficialmente** por outra forma de validacao equivalente, se houver justificativa tecnica real;
3. atualizar a documentacao para refletir a decisao.

Importante:

- nao deixar a documentacao dizendo que `events polling` esta coberto se o teste nao existir;
- nao manter teste estrutural incorreto sobre `/events`.

### Frente C — Execucao Reproduzivel de Playwright

O Claude Code deve garantir que outra pessoa consiga entender como rodar:

- qual compose usar;
- quais servicos precisam subir;
- quais comandos executar;
- o que o bootstrap faz;
- o que acontece se o ambiente nao estiver pronto.

Arquivos provaveis a ajustar:

- `e2e/README.md`
- `playwright.config.ts`
- `e2e/support/start-e2e-stack.ts`
- scripts em `package.json`, se necessario

Se houver fragilidade pratica no bootstrap, corrigir de forma minima e segura.

## 6. Criterios de Aceite

Esta task so pode ser considerada bem-sucedida se:

1. a documentacao de E2E estiver coerente com o codigo real;
2. o tema `events polling` deixar de estar contraditorio;
3. houver cobertura restaurada ou uma substituicao bem justificada;
4. a trilha Playwright ficar mais reproduzivel para outro engineer;
5. o relatorio final diferenciar claramente:
   - o que foi corrigido;
   - o que foi restaurado;
   - o que foi apenas documentado;
   - o que foi realmente executado.

## 7. Fora de Escopo

Nao abrir nesta task:

- nova frente de produto;
- nova bateria ampla de E2E;
- CI completo;
- refatoracao grande do desk-web;
- alterar a arquitetura de realtime/eventos alem do necessario para reconciliar cobertura e docs.

## 8. Arquivos a Inspecionar Primeiro

### Docs

- `docs/GAPS-TECNICOS.md`
- `docs/25-plano-testes-completo.md`
- `docs/19-test-strategy.md`
- `docs/16-validation-checklist.md`

### E2E

- `playwright.config.ts`
- `e2e/README.md`
- `e2e/support/start-e2e-stack.ts`
- `e2e/smoke/*`

### API / Tests

- `apps/desk-api/src/app.ts`
- `apps/desk-api/src/index.ts`
- `apps/desk-api/src/__tests__/`
- `apps/realtime-service/src/index.ts`

## 9. Entregavel Obrigatorio

Ao final, o Claude Code deve entregar um relatorio completo contendo:

1. documentos consultados;
2. estado atual confirmado no codigo;
3. inconsistencias encontradas;
4. o que foi corrigido;
5. arquivos alterados;
6. como ficou a cobertura de `events polling`;
7. como ficou a trilha de execucao do Playwright;
8. o que foi realmente executado;
9. riscos remanescentes;
10. decisao final:
   - `PRONTO`
   - `PARCIAL`
   - `PENDENTE`

## 10. Instrucao Final

Leia este documento inteiro antes de qualquer alteracao.

Depois:

1. leia os documentos obrigatorios;
2. valide no codigo o estado atual;
3. corrija a documentacao incoerente;
4. restaure ou substitua a cobertura de `events polling`;
5. deixe a execucao Playwright mais reproduzivel;
6. execute o que for viavel;
7. entregue o relatorio final no formato deste plano.
