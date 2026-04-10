# Plano de Execucao — GitHub Actions para Smoke E2E

Data: 2026-04-10
Status: Ativo
Escopo: Fechar o proximo gap real da trilha de testes com uma esteira minima de CI para smoke Playwright

## 1. Objetivo

O projeto ja possui:

- Playwright configurado;
- stack dedicada de smoke em `docker-compose.smoke.yml`;
- scripts operacionais de smoke;
- smoke tests browser-driven reais;
- bootstrap reproducivel local.

O proximo gap real que permanece na `/docs` e:

- **CI pipeline validando os smoke tests**.

O objetivo desta task e criar a primeira esteira automatizada minima para rodar a trilha de smoke em GitHub Actions, sem inflar escopo.

## 2. Fonte da Verdade Obrigatoria

Antes de qualquer alteracao, o Claude Code deve ler:

1. `docs/49-plano-execucao-claude-code-ci-github-smoke-e2e.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/25-plano-testes-completo.md`
4. `docs/19-test-strategy.md`
5. `docs/16-validation-checklist.md`
6. `docs/21-instalacao-local.md`
7. `e2e/README.md`
8. `docs/48-plano-execucao-claude-code-ci-smoke-playwright.md`
9. `docs/47-plano-execucao-claude-code-smoke-stack-dedicada-execucao-real.md`

Regras:

- usar `/docs` como fonte da verdade;
- validar no codigo o estado atual antes de implementar;
- reutilizar os scripts e a stack reais do projeto;
- nao vender como "totalmente pronto" algo que nao puder ser validado remotamente daqui.

## 3. Estado Atual Esperado

O Claude Code deve confirmar no codigo:

- `docker-compose.smoke.yml` existe;
- `package.json` possui `e2e:stack:up`, `e2e:stack:down`, `test:e2e:smoke`;
- `playwright.config.ts` esta funcional para a stack dedicada;
- `e2e/support/start-e2e-stack.ts` sobe a stack da aplicacao;
- nao existe `.github/workflows/` ainda, ou nao existe workflow cobrindo o smoke.

## 4. Objetivo Tecnico da Task

Executar esta task nesta ordem:

1. mapear a forma minima de rodar o smoke em CI;
2. criar workflow de GitHub Actions;
3. ajustar scripts/comandos apenas se necessario;
4. garantir debug minimo por artifacts/logs;
5. atualizar a documentacao com o novo estado.

## 5. Escopo Obrigatorio

### Frente A — Workflow GitHub Actions

Criar `.github/workflows/smoke-e2e.yml` ou nome equivalente.

O workflow minimo deve contemplar:

- checkout;
- setup de Node;
- setup de pnpm;
- install de dependencias;
- install do browser Playwright;
- subida da smoke stack;
- execucao de `pnpm test:e2e:smoke`;
- teardown da smoke stack;
- upload de artifacts uteis em caso de falha.

Eventos minimos esperados:

- `pull_request`
- `push` para branch principal ou branchs relevantes

### Frente B — Ajustes Minimos para CI

O Claude Code pode ajustar o minimo necessario em:

- `package.json`
- `playwright.config.ts`
- `e2e/support/start-e2e-stack.ts`
- `e2e/README.md`

Somente se isso for necessario para tornar a execucao mais previsivel em ambiente automatizado.

### Frente C — Artifacts e Diagnostico

A esteira deve preservar o minimo util para debug:

- trace/screenshot/video, se ja suportado pelo Playwright;
- logs ou output relevante do smoke;
- instrucoes claras de reproducao local.

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

1. existir workflow de CI para smoke;
2. o workflow reutilizar a stack e os scripts reais do projeto;
3. existir estrategia minima de artifact/debug;
4. a documentacao refletir o novo estado;
5. o relatorio final diferenciar:
   - configurado em CI;
   - validado localmente;
   - nao validado remotamente, se for o caso.

Se o workflow for criado mas nao puder ser validado no GitHub a partir deste ambiente, a decisao final pode continuar `PARCIAL`.

## 7. Fora de Escopo

Nao abrir nesta task:

- matrix multi-browser;
- pipeline completa do monorepo;
- coverage ampla;
- deploy;
- novos smoke tests funcionais.

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
3. estrategia escolhida para a esteira CI;
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
3. implemente a esteira minima de GitHub Actions;
4. ajuste scripts/docs se necessario;
5. execute o que for viavel localmente;
6. atualize a documentacao;
7. entregue o relatorio final no formato deste plano.
