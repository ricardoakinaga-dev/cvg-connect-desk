# Plano de Execucao — Smoke Stack Dedicada e Execucao Real

Data: 2026-04-10
Status: Ativo
Escopo: Tornar a trilha Playwright operacional com stack dedicada, scripts claros e execucao real reproduzivel

## 1. Objetivo

Este plano existe para dar o proximo passo mais util na trilha E2E:

- criar uma stack dedicada de smoke;
- padronizar scripts de subida, execucao e teardown;
- reduzir dependencia de ambiente manual;
- permitir execucao real previsivel dos smoke tests existentes.

O foco desta task nao e ampliar muito a cobertura funcional.
O foco e deixar a execucao dos smoke tests confiavel para outro engineer e preparar o terreno para CI futura.

## 2. Fonte da Verdade Obrigatoria

Antes de qualquer alteracao, o Claude Code deve ler:

1. `docs/47-plano-execucao-claude-code-smoke-stack-dedicada-execucao-real.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/25-plano-testes-completo.md`
4. `docs/19-test-strategy.md`
5. `docs/16-validation-checklist.md`
6. `docs/18-deployment-and-runtime.md`
7. `docs/21-instalacao-local.md`
8. `e2e/README.md`
9. `docs/46-plano-execucao-claude-code-smoke-stack-ci-local.md`

## 3. Estado Atual Esperado

O Claude Code deve confirmar no codigo, antes de implementar:

- Playwright configurado no root;
- `e2e/support/start-e2e-stack.ts` existente;
- smoke tests em `e2e/smoke/`;
- dependencia real de PostgreSQL para bootstrap e fixtures;
- estado atual dos `docker-compose*.yml`;
- como os scripts do monorepo estao organizados.

## 4. Objetivo Tecnico da Task

Executar esta task nesta ordem:

1. mapear o minimo de infra que o smoke realmente precisa;
2. criar uma stack dedicada e previsivel para smoke;
3. adicionar scripts operacionais claros;
4. ajustar o bootstrap E2E, se necessario;
5. executar a trilha real de smoke;
6. atualizar a documentacao com precisao.

## 5. Escopo Obrigatorio

### Frente A — Stack Dedicada de Smoke

Criar uma forma clara e dedicada de subir a infra minima do smoke.

Preferencia:

- `docker-compose.smoke.yml`

ou, se houver justificativa melhor:

- perfil claramente separado em compose existente.

Essa stack deve deixar explicito:

- quais servicos sao realmente necessarios;
- quais portas ela usa;
- como evita colisao com ambiente dev comum;
- como subir e derrubar de forma limpa.

### Frente B — Scripts Operacionais

Adicionar ou ajustar scripts no `package.json` raiz para algo equivalente a:

- `smoke:up`
- `smoke:down`
- `smoke:test`
- `smoke:test:headed` ou equivalente

Os nomes exatos podem variar, mas precisam ser claros e consistentes.

O resultado esperado:

- outra pessoa consegue executar a trilha sem montar comandos manualmente;
- a documentacao pode apontar para scripts simples.

### Frente C — Execucao Real

O Claude Code deve tentar executar de fato:

1. subida da stack dedicada;
2. execucao dos smoke tests Playwright;
3. teardown da stack.

Se algum passo nao for viavel no ambiente atual, isso deve ser registrado com precisao.

Importante:

- nao vender "pronto" se os comandos nao tiverem sido exercitados;
- se houver falha, registrar onde falhou e o que falta.

### Frente D — Ajustes Minimos no Bootstrap

Revisar `e2e/support/start-e2e-stack.ts` e ajustar apenas o necessario para:

- funcionar bem com a stack dedicada;
- ter mensagens de erro melhores;
- evitar dependencia oculta;
- continuar simples.

### Frente E — Documentacao

Atualizar, no minimo:

- `e2e/README.md`
- `docs/21-instalacao-local.md`
- `docs/25-plano-testes-completo.md`
- `docs/GAPS-TECNICOS.md`

Se necessario:

- `docs/19-test-strategy.md`
- `docs/18-deployment-and-runtime.md`
- `docs/16-validation-checklist.md`

## 6. Critérios de Aceite

Esta task so pode ser considerada bem-sucedida se:

1. existir uma stack dedicada ou claramente separada para smoke;
2. existirem scripts simples para subir, rodar e derrubar;
3. a execucao real tiver sido tentada e reportada;
4. a documentacao estiver coerente com o fluxo final;
5. o relatorio final diferenciar:
   - configurado;
   - implementado;
   - executado;
   - pendente.

## 7. Fora de Escopo

Nao abrir nesta task:

- GitHub Actions completas;
- cross-browser;
- novos fluxos E2E amplos;
- refatoracao grande da aplicacao;
- suite enterprise de ponta a ponta.

## 8. Arquivos a Inspecionar Primeiro

- `package.json`
- `playwright.config.ts`
- `e2e/support/start-e2e-stack.ts`
- `e2e/README.md`
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
6. scripts finais;
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
3. implemente a stack dedicada;
4. ajuste scripts e bootstrap;
5. execute o fluxo real do smoke;
6. atualize a documentacao;
7. entregue o relatorio final no formato deste plano.
