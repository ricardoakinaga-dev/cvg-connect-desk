# Plano de Execucao — CI das Suites Criticas com Banco Real

Data: 2026-04-10
Status: Ativo
Escopo: Continuar reduzindo o G-06 com automacao das suites criticas que dependem de PostgreSQL real

## 1. Objetivo

O projeto ja possui:

- smoke E2E com Playwright em CI;
- testes HTTP/API relevantes;
- testes comportamentais de eventos;
- suites reais que exercitam PostgreSQL localmente.

O gap restante mais util agora e:

- mover para CI um subconjunto pequeno, mas valioso, das suites que dependem de PostgreSQL real;
- reduzir a situacao atual em que parte da validacao mais importante ainda depende de ambiente manual;
- deixar um caminho reproduzivel entre execucao local e GitHub Actions.

## 2. Fonte da Verdade Obrigatoria

Antes de qualquer alteracao, o Codex deve ler:

1. `docs/57-plano-execucao-claude-code-ci-db-critical-suites.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/56-plano-execucao-claude-code-ci-integration-postgres-real.md`
4. `docs/25-plano-testes-completo.md`
5. `docs/19-test-strategy.md`
6. `docs/16-validation-checklist.md`
7. `docs/21-instalacao-local.md`
8. `docs/18-deployment-and-runtime.md`

## 3. Estado Atual a Revalidar no Codigo

O Codex deve confirmar:

- quais suites com PostgreSQL real ja existem e sao mais estaveis;
- quais comandos realmente executam essas suites hoje;
- se o CI atual ja tem base suficiente para compartilhar setup de banco;
- se existe script local equivalente claro;
- quais testes ainda ficam skipped ou bloqueados apenas por ausencia de banco.

Areas para inspecao inicial:

- `.github/workflows/`
- `package.json` raiz
- `packages/database`
- `apps/desk-api/src/__tests__/`
- `modules/chat/src/__tests__/`
- `packages/events/src/__tests__/`

## 4. Objetivo Tecnico da Task

Executar esta task nesta ordem:

1. escolher as suites reais mais valiosas e mais maduras;
2. definir o menor workflow de CI util para elas;
3. implementar scripts/workflow faltantes;
4. validar localmente o maximo possivel;
5. atualizar a documentacao.

## 5. Escopo Obrigatorio

### Frente A — Selecionar Suites

Escolher um conjunto pequeno e justificado de suites com PostgreSQL real.

Preferencia inicial:

- `apps/desk-api` integracoes criticas;
- `modules/chat` idempotencia inbound;
- `packages/events` apenas se a suite real estiver suficientemente estavel.

Se alguma suite ainda estiver muito fragil, documentar isso e deixar fora do workflow desta rodada.

### Frente B — Workflow de CI

Implementar a menor esteira util no GitHub Actions para essas suites.

Preferencia:

- usar service container de PostgreSQL;
- aplicar migrations reais;
- rodar apenas as suites selecionadas;
- produzir logs/artifacts uteis apenas se agregarem valor;
- evitar workflow excessivamente grande.

### Frente C — Script Local Equivalente

Garantir que exista um caminho local simples para reproduzir o que o CI faz:

- script na raiz ou comando claramente documentado;
- variaveis de ambiente consistentes;
- setup minimo do banco real.

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

1. houver um workflow minimo de CI para suites criticas com PostgreSQL real;
2. as suites escolhidas estiverem justificadas;
3. existir comando local equivalente documentado;
4. a documentacao refletir honestamente o que foi automatizado e o que ficou fora.

## 7. Fora de Escopo

Nao abrir nesta task:

- todas as suites do monorepo em CI;
- matriz de bancos;
- redisenho amplo da estrategia de testes;
- cobertura completa enterprise.

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
