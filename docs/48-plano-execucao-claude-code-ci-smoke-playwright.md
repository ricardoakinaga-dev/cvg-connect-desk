# Plano de Execucao — CI Smoke com Playwright

Data: 2026-04-10
Status: Ativo
Escopo: Fechar o proximo gap real da trilha de testes com uma esteira minima de CI para smoke E2E

## 1. Objetivo

Este plano existe para atacar o proximo gap objetivo do projeto:

- inexistencia de pipeline CI validando os smoke tests;
- ausencia de uma execucao automatizada por commit/PR;
- necessidade de transformar a trilha local de smoke em base reproduzivel tambem para CI.

O objetivo desta task e:

- criar uma esteira minima de CI para smoke;
- reutilizar a stack dedicada e os scripts ja consolidados;
- deixar claro o contrato de execucao em ambiente automatizado;
- atualizar a documentacao com precisao.

Nao e objetivo desta task:

- montar pipeline enterprise completa;
- adicionar multiplos navegadores;
- ampliar muito a cobertura funcional;
- reestruturar toda a estrategia de CI do monorepo.

## 2. Fonte da Verdade Obrigatoria

Antes de qualquer alteracao, o Claude Code deve ler:

1. `docs/48-plano-execucao-claude-code-ci-smoke-playwright.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/25-plano-testes-completo.md`
4. `docs/19-test-strategy.md`
5. `docs/16-validation-checklist.md`
6. `docs/21-instalacao-local.md`
7. `e2e/README.md`
8. `docs/47-plano-execucao-claude-code-smoke-stack-dedicada-execucao-real.md`

## 3. Estado Atual Esperado

O Claude Code deve confirmar no codigo, antes de implementar:

- stack dedicada de smoke em `docker-compose.smoke.yml`;
- scripts `e2e:stack:up`, `e2e:stack:down`, `test:e2e:smoke`;
- Playwright configurado e smoke tests existentes;
- bootstrap E2E minimamente estavel;
- ausencia atual de CI pipeline validando esses smoke tests.

## 4. Objetivo Tecnico da Task

Executar esta task nesta ordem:

1. mapear a forma minima e segura de rodar o smoke em CI;
2. criar workflow ou mecanismo equivalente de CI;
3. adaptar scripts/comandos, se necessario;
4. garantir artefatos/logs minimos uteis para debug;
5. atualizar a documentacao com o novo estado.

## 5. Escopo Obrigatorio

### Frente A — Workflow de CI Minimo

Criar uma esteira minima para o smoke Playwright.

Preferencia:

- workflow de GitHub Actions em `.github/workflows/`

Se houver justificativa tecnica forte, outra abordagem pode ser usada, mas o default esperado e GitHub Actions.

A esteira minima deve contemplar:

- checkout;
- setup de Node/pnpm;
- instalacao de dependencias;
- instalacao de browser Playwright;
- subida da stack de smoke;
- execucao de `pnpm test:e2e:smoke`;
- teardown/cleanup apropriado;
- artefatos minimos se o smoke falhar.

### Frente B — Ajustes de Script / Runner

O Claude Code pode ajustar o minimo necessario para tornar a execucao em CI mais confiavel, por exemplo:

- scripts adicionais dedicados a CI;
- logs melhores;
- timeout apropriado;
- ajuste pontual em `playwright.config.ts`;
- algum endurecimento pequeno no bootstrap.

Mas deve evitar refatoracao ampla.

### Frente C — Artefatos e Debug

A esteira deve produzir o minimo util para debug, como:

- traces do Playwright quando houver retry/falha;
- logs ou upload de artifacts relevantes;
- instrucoes simples para reproduzir localmente o mesmo fluxo.

### Frente D — Documentacao

Atualizar, no minimo:

- `docs/GAPS-TECNICOS.md`
- `docs/25-plano-testes-completo.md`
- `docs/19-test-strategy.md`
- `docs/16-validation-checklist.md`
- `e2e/README.md`

Se necessario:

- `docs/21-instalacao-local.md`

## 6. Critérios de Aceite

Esta task so pode ser considerada bem-sucedida se:

1. existir uma esteira minima de CI para smoke;
2. a execucao usar a stack e os scripts reais do projeto;
3. a documentacao refletir o novo estado;
4. o relatorio final diferenciar:
   - configurado;
   - implementado;
   - executado localmente;
   - preparado para CI;
   - eventualmente nao validado em GitHub, se isso nao puder ser exercitado aqui.

Se o workflow for criado mas nao puder ser validado no provedor remoto, a decisao final pode continuar `PARCIAL`.

## 7. Fora de Escopo

Nao abrir nesta task:

- matrix multi-browser;
- pipeline completa do monorepo;
- coverage reporting amplo;
- deploy automatizado;
- suite E2E maior.

## 8. Arquivos a Inspecionar Primeiro

- `package.json`
- `playwright.config.ts`
- `docker-compose.smoke.yml`
- `e2e/support/start-e2e-stack.ts`
- `e2e/README.md`
- `.github/` se existir

## 9. Entregavel Obrigatorio

Ao final, o Claude Code deve entregar um relatorio contendo:

1. documentos consultados;
2. estado atual confirmado no codigo;
3. estrategia escolhida para CI smoke;
4. o que foi implementado;
5. arquivos alterados;
6. como ficou a execucao em CI;
7. o que foi realmente executado localmente;
8. riscos remanescentes;
9. decisao final:
   - `PRONTO`
   - `PARCIAL`
   - `PENDENTE`

## 10. Instrucao Final

Leia este documento inteiro antes de qualquer alteracao.

Depois:

1. leia os documentos obrigatorios;
2. valide no codigo o estado atual;
3. implemente a esteira minima de CI;
4. ajuste scripts e docs se necessario;
5. execute o que for viavel localmente;
6. atualize a documentacao;
7. entregue o relatorio final no formato deste plano.
