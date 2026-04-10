# Plano de Execucao — Fechamento de Reconciliacao: Tests, E2E e Events

Data: 2026-04-10
Status: Ativo
Escopo: Corrigir as ultimas inconsistencias entre codigo, testes e documentacao antes de considerar a trilha de validacao estabilizada

## 1. Objetivo

Este plano existe para fechar a proxima rodada de reconciliacao do projeto, atacando tres pontos que ainda permanecem inconsistentes:

1. a verdade atual da rota `/events` e sua cobertura;
2. a documentacao de testes que ainda cita artefatos inexistentes ou desatualizados;
3. a trilha Playwright/E2E, para deixá-la claramente reproduzivel e sem ambiguidades.

O objetivo nao e abrir novas frentes de produto.
O objetivo e consolidar a confianca na base de teste/documentacao do projeto.

## 2. Fonte da Verdade Obrigatoria

Antes de qualquer alteracao, o Claude Code deve ler:

1. `docs/44-plano-execucao-claude-code-fechamento-reconciliacao-tests-e2e-events.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/25-plano-testes-completo.md`
4. `docs/19-test-strategy.md`
5. `docs/16-validation-checklist.md`
6. `docs/18-deployment-and-runtime.md`
7. `docs/21-instalacao-local.md`
8. `docs/43-plano-execucao-claude-code-reconciliacao-e2e-events-polling.md`

Regras:

- validar o estado atual no codigo antes de editar docs;
- nao manter no texto nenhuma claim que nao tenha evidência no repositorio;
- diferenciar claramente:
  - implementado;
  - coberto por teste;
  - executado;
  - documentado.

## 3. Problemas Ja Confirmados

### 3.1 `events polling` ficou contraditorio

Hoje:

- `apps/desk-api/src/app.ts` ainda expõe `/events`;
- a documentacao continua citando `events polling tests` como entregues;
- mas `apps/desk-api/src/__tests__/events-polling.integration.test.ts` nao existe mais;
- testes estruturais de algumas areas passaram a falar mais de `deadLetterStore` e `/admin/dead-letters`.

O Claude Code precisa decidir e materializar a verdade:

- `/events` continua endpoint relevante e deve ter teste real restaurado; ou
- `/events` mudou de papel e precisa ter substituicao de cobertura/documentacao.

Nao pode permanecer ambiguo.

### 3.2 Documentacao de testes ainda nao esta 100% reconciliada

Ha pelo menos os seguintes riscos:

- referencias a arquivos de teste removidos;
- status de cobertura otimista demais;
- mismatch entre "Playwright configurado" e "Playwright executado";
- docs ainda citando `events polling` como entregue sem o teste correspondente.

### 3.3 Trilha Playwright precisa ficar operacional para outra pessoa

Ja existem:

- `playwright.config.ts`
- `e2e/support/start-e2e-stack.ts`
- `e2e/README.md`
- smoke tests reais

Mas a documentacao operacional ainda precisa deixar cristalino:

- quando usar `.env`;
- quando usar `docker compose` ou stack local;
- o que e requisito minimo;
- como reproduzir a execucao sem depender de contexto oral.

## 4. Objetivo Tecnico da Task

O Claude Code deve executar esta task nesta ordem:

1. confirmar a verdade atual de `/events`;
2. restaurar ou substituir a cobertura de `events polling`;
3. reconciliar toda a documentacao de testes/E2E com o estado real;
4. endurecer a trilha de execucao Playwright para outra pessoa conseguir rodar;
5. executar o que for viavel e registrar com precisao.

## 5. Escopo Obrigatorio

### Frente A — Verdade Atual de `/events`

O Claude Code deve inspecionar:

- `apps/desk-api/src/app.ts`
- `apps/desk-api/src/index.ts`
- `apps/realtime-service/src/index.ts`
- `packages/events`
- testes existentes que citam `/events`

Depois disso, deve tomar uma decisao implementada:

#### Opcao 1 — Restaurar cobertura real

Se `/events` continua parte relevante do fluxo:

- recriar ou substituir um teste de integracao real;
- validar contrato, filtro, limit e/ou comportamento atual real;
- alinhar os docs com esse teste real.

#### Opcao 2 — Rebaixar ou substituir oficialmente

Se `/events` deixou de ser a cobertura principal esperada:

- atualizar docs para refletir isso;
- remover claims antigas;
- deixar registrado qual cobertura substitui esse risco hoje.

Importante:

- nao deixar docs dizendo que existe teste entregue se ele nao existe;
- nao deixar o endpoint sem explicacao de papel atual.

### Frente B — Reconciliacao Documental de Testes

Revisar e corrigir, no minimo:

- `docs/GAPS-TECNICOS.md`
- `docs/25-plano-testes-completo.md`
- `docs/19-test-strategy.md`
- `docs/16-validation-checklist.md`
- `docs/18-deployment-and-runtime.md`
- `docs/21-instalacao-local.md`

Resultado esperado:

- lista de testes coerente com arquivos reais;
- status coerente de cobertura e execucao;
- remocao de referencias obsoletas;
- explicacao clara do papel atual da trilha Playwright;
- explicacao clara do papel atual de `/events`.

### Frente C — Trilha Playwright Reproduzivel

O Claude Code deve revisar e, se necessario, ajustar:

- `e2e/README.md`
- `playwright.config.ts`
- `e2e/support/start-e2e-stack.ts`
- scripts em `package.json`

O resultado esperado:

- outra pessoa consegue seguir um passo a passo claro;
- os pre-requisitos ficam explicitos;
- comandos reais ficam padronizados;
- qualquer dependencia de `.env`, `DATABASE_URL` ou stack local fica documentada sem ambiguidade.

## 6. Critérios de Aceite

Esta task so pode ser considerada bem-sucedida se:

1. `/events` deixar de estar contraditorio;
2. a documentacao de testes/E2E estiver coerente com o codigo real;
3. a trilha Playwright ficar mais reproduzivel;
4. o relatorio final diferenciar claramente:
   - o que foi corrigido;
   - o que foi restaurado;
   - o que foi documentado;
   - o que foi realmente executado.

## 7. Fora de Escopo

Nao abrir nesta task:

- nova frente de produto;
- nova bateria ampla de E2E;
- CI completo;
- refatoracao grande de frontend/backend;
- redesign do fluxo de eventos alem do necessario para reconciliar cobertura.

## 8. Arquivos a Inspecionar Primeiro

### Docs

- `docs/GAPS-TECNICOS.md`
- `docs/25-plano-testes-completo.md`
- `docs/19-test-strategy.md`
- `docs/16-validation-checklist.md`
- `docs/18-deployment-and-runtime.md`
- `docs/21-instalacao-local.md`

### API / Eventos

- `apps/desk-api/src/app.ts`
- `apps/desk-api/src/index.ts`
- `apps/desk-api/src/__tests__/`
- `apps/realtime-service/src/index.ts`
- `packages/events`

### E2E

- `playwright.config.ts`
- `e2e/README.md`
- `e2e/support/start-e2e-stack.ts`
- `e2e/smoke/*`

## 9. Entregavel Obrigatorio

Ao final, o Claude Code deve entregar um relatorio contendo:

1. documentos consultados;
2. estado atual confirmado no codigo;
3. inconsistencias encontradas;
4. o que foi corrigido;
5. arquivos alterados;
6. como ficou a verdade de `/events`;
7. como ficou a trilha Playwright;
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
2. confirme o estado atual no codigo;
3. resolva a contradicao de `/events`;
4. reconcilie a documentacao de testes/E2E;
5. deixe a trilha Playwright mais reproduzivel;
6. execute o que for viavel;
7. entregue o relatorio final no formato deste plano.
