# Plano de Execucao — Smoke Stack Reproduzivel para CI Local

Data: 2026-04-10
Status: Ativo
Escopo: Consolidar a trilha Playwright para execucao previsivel em maquina local e preparacao para CI

## 1. Objetivo

Este plano existe para transformar a trilha atual de smoke E2E em uma base mais operacional para o time.

Objetivos desta task:

- padronizar uma stack minima dedicada para smoke;
- reduzir dependencia de ambiente manual e estado implicito;
- deixar claro como subir, executar e derrubar o ambiente;
- preparar a base para uma futura esteira CI sem prometer CI completa agora.

Nao e objetivo desta task:

- implementar pipeline CI completo;
- criar uma suite E2E enterprise;
- aumentar muito a cobertura funcional.

## 2. Fonte da Verdade Obrigatoria

Antes de qualquer alteracao, o Claude Code deve ler:

1. `docs/46-plano-execucao-claude-code-smoke-stack-ci-local.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/25-plano-testes-completo.md`
4. `docs/19-test-strategy.md`
5. `docs/16-validation-checklist.md`
6. `docs/18-deployment-and-runtime.md`
7. `docs/21-instalacao-local.md`
8. `e2e/README.md`
9. `docs/45-plano-execucao-claude-code-smoke-send-message-fixture-estavel.md`

## 3. Estado Atual Esperado

Antes de implementar, o Claude Code deve confirmar no codigo:

- Playwright configurado no root;
- bootstrap E2E em `e2e/support/start-e2e-stack.ts`;
- smoke tests ja existentes em `e2e/smoke/`;
- dependencia real de PostgreSQL para o smoke;
- quais variaveis de ambiente precisam existir de verdade.

## 4. Objetivo Tecnico da Task

Executar esta task nesta ordem:

1. mapear os requisitos reais da stack de smoke;
2. criar uma forma mais padronizada de subir a infra minima;
3. adicionar scripts claros de execucao e teardown;
4. revisar o bootstrap E2E para evitar dependencia oculta;
5. atualizar a documentacao operacional.

## 5. Escopo Obrigatorio

### Frente A — Stack Minima Dedicada

Implementar uma estrategia clara para a stack de smoke.

Exemplos aceitaveis:

- `docker-compose.smoke.yml`; ou
- reutilizacao segura de `docker-compose.dev.yml` com perfil/documentacao especifica; ou
- outro mecanismo equivalente que reduza ambiguidade.

O resultado precisa deixar explicito:

- quais servicos o smoke realmente precisa;
- quais portas sao usadas;
- o que e obrigatorio e o que e opcional;
- como evitar colisao com ambiente local comum.

### Frente B — Scripts de Execucao

Adicionar ou ajustar scripts para algo como:

- subir stack de smoke;
- executar smoke E2E;
- derrubar stack;
- opcionalmente limpar estado de smoke.

Os nomes exatos podem variar, mas precisam ficar claros e consistentes.

### Frente C — Hardening do Bootstrap

Revisar `e2e/support/start-e2e-stack.ts` e ajustar o minimo necessario para:

- deixar claro de onde vem `.env`;
- falhar com mensagens mais objetivas quando o banco nao estiver acessivel;
- evitar dependencia silenciosa de estado previo;
- documentar melhor o bootstrap admin e as portas usadas.

### Frente D — Documentacao

Atualizar, no minimo:

- `e2e/README.md`
- `docs/21-instalacao-local.md`
- `docs/25-plano-testes-completo.md`
- `docs/GAPS-TECNICOS.md`

Se necessario:

- `docs/19-test-strategy.md`
- `docs/18-deployment-and-runtime.md`

## 6. Critérios de Aceite

Esta task so pode ser considerada bem-sucedida se:

1. existir um caminho claro e reproduzivel para subir a stack de smoke;
2. existir um caminho claro para executar e derrubar o smoke;
3. a documentacao operacional ficar coerente com o codigo;
4. os scripts deixarem o fluxo mais facil para outro engineer;
5. o relatorio final diferenciar:
   - o que foi configurado;
   - o que foi executado;
   - o que ficou apenas preparado para CI futura.

## 7. Fora de Escopo

Nao abrir nesta task:

- GitHub Actions completas;
- matrix cross-browser;
- cobertura funcional ampla adicional;
- refatoracao grande do frontend/backend;
- suite visual.

## 8. Arquivos a Inspecionar Primeiro

- `playwright.config.ts`
- `e2e/support/start-e2e-stack.ts`
- `e2e/README.md`
- `package.json`
- `docker-compose.yml`
- `docker-compose.dev.yml`
- `e2e/smoke/*`

## 9. Entregavel Obrigatorio

Ao final, o Claude Code deve entregar um relatorio contendo:

1. documentos consultados;
2. estado atual confirmado no codigo;
3. estrategia escolhida para stack de smoke;
4. o que foi implementado;
5. arquivos alterados;
6. scripts/comandos finais;
7. o que foi realmente executado;
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
3. implemente a stack minima reproduzivel;
4. ajuste scripts e bootstrap;
5. atualize a documentacao;
6. execute o que for viavel;
7. entregue o relatorio final no formato deste plano.
