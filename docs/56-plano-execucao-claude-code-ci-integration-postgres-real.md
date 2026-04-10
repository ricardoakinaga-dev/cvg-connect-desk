# Plano de Execucao — CI para Suites com PostgreSQL Real

Data: 2026-04-10
Status: Ativo
Escopo: Reduzir o restante do G-06 executando em CI as suites que ainda dependem de PostgreSQL real

## 1. Objetivo

O projeto ja avancou bastante em testes:

- smoke E2E com Playwright;
- testes de integracao HTTP/API;
- testes comportamentais do pipeline de eventos;
- testes reais de idempotencia inbound;
- integrações Secretary/handoff.

O gap restante mais claro em `G-06` e:

- parte da cobertura mais valiosa ainda depende de PostgreSQL real;
- em varios fluxos, os testes existem mas ficam condicionais ao ambiente local;
- o CI atual cobre smoke E2E, mas ainda nao consolida essas suites reais de banco.

O objetivo desta task e:

- identificar as suites mais importantes que dependem de PostgreSQL real;
- criar uma esteira minima de CI para executa-las de forma reproduzivel;
- reduzir a dependencia de ambiente manual para validar os testes mais valiosos.

## 2. Fonte da Verdade Obrigatoria

Antes de qualquer alteracao, o Codex deve ler:

1. `docs/56-plano-execucao-claude-code-ci-integration-postgres-real.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/25-plano-testes-completo.md`
4. `docs/19-test-strategy.md`
5. `docs/16-validation-checklist.md`
6. `docs/18-deployment-and-runtime.md`
7. `docs/21-instalacao-local.md`

## 3. Estado Atual a Revalidar no Codigo

O Codex deve confirmar:

- quais suites hoje usam PostgreSQL real;
- quais delas sao as mais valiosas para risco de regressao;
- quais comandos realmente funcionam no monorepo;
- se ja existe docker-compose ou setup suficiente para banco em CI;
- quais testes falham hoje apenas por ausencia de banco.

Arquivos/areas para inspecao inicial:

- `.github/workflows/`
- `packages/database`
- `apps/desk-api/src/__tests__/`
- `modules/chat/src/__tests__/`
- `packages/events/src/__tests__/`
- scripts de teste no `package.json` raiz e dos packages

## 4. Objetivo Tecnico da Task

Executar esta task nesta ordem:

1. mapear as suites reais prioritarias;
2. definir a menor esteira de CI viavel;
3. implementar workflow(s) e scripts faltantes;
4. validar localmente o maximo possivel;
5. atualizar a documentacao.

## 5. Escopo Obrigatorio

### Frente A — Escolha das Suites

Selecionar um conjunto minimo, mas valioso, de suites com PostgreSQL real.

Preferencia inicial:

- `apps/desk-api` integracoes criticas com banco;
- `modules/chat` idempotencia inbound;
- `packages/events` suites reais de banco, se estiverem maduras o suficiente;

Se alguma suite ainda estiver instavel ou depender de muito setup manual, documentar isso e nao forcar a entrada no CI nesta task.

### Frente B — Workflow de CI

Implementar workflow minimo de GitHub Actions para essas suites reais.

Preferencia:

- usar service container de PostgreSQL no workflow ou stack local equivalente ja existente;
- aplicar migrations reais;
- rodar apenas as suites selecionadas;
- publicar logs/artifacts uteis se fizer sentido;
- evitar overengineering.

### Frente C — Scripts e Reprodutibilidade

Se necessario:

- criar script dedicado na raiz ou no package relevante;
- padronizar variaveis de ambiente;
- documentar o comando local equivalente ao que o CI roda.

### Frente D — Documentacao

Atualizar no minimo:

- `docs/GAPS-TECNICOS.md`
- `docs/25-plano-testes-completo.md`
- `docs/19-test-strategy.md`
- `docs/16-validation-checklist.md`

Se necessario:

- `docs/21-instalacao-local.md`
- `docs/18-deployment-and-runtime.md`

## 6. Criterios de Aceite

Esta task so pode ser considerada bem-sucedida se:

1. houver uma esteira minima de CI para suites com PostgreSQL real;
2. as suites escolhidas forem justificadas e coerentes com o risco;
3. existir comando local equivalente documentado;
4. a documentacao refletir honestamente o que foi automatizado e o que ainda ficou fora.

## 7. Fora de Escopo

Nao abrir nesta task:

- cobertura total de todos os testes do monorepo em CI;
- matriz de bancos;
- persistencia de snapshots pesados;
- redesign amplo da estrategia de testes.

## 8. Entregavel Obrigatorio

Ao final, o Codex deve entregar um relatorio contendo:

1. documentos consultados;
2. estado atual confirmado no codigo;
3. suites escolhidas e justificativa;
4. o que foi implementado;
5. arquivos alterados;
6. testes/comandos executados;
7. riscos remanescentes;
8. decisao final:
   - `PRONTO`
   - `PARCIAL`
   - `PENDENTE`

## 9. Instrucao Final

Leia este documento inteiro antes de qualquer alteracao.

Depois:

1. leia os documentos obrigatorios;
2. revalide as suites reais prioritarias;
3. implemente a menor esteira util de CI com PostgreSQL real;
4. valide localmente o que for possivel;
5. atualize a documentacao;
6. entregue o relatorio final no formato deste plano.
