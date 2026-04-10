# Plano de Execucao — Frontend Page Tests Criticos

Data: 2026-04-10
Status: Ativo
Escopo: Reduzir o restante do G-06 fortalecendo a cobertura de paginas/componentes do `desk-web`

## 1. Objetivo

O projeto ja avancou fortemente em:

- eventos;
- integrações API;
- Secretary/handoff;
- smoke E2E com Playwright;
- CI de smoke e suites com PostgreSQL real.

O proximo gap util no `G-06` fica concentrado no frontend:

- hoje o `desk-web` possui poucos testes locais;
- faltam testes de paginas/componentes para fluxos centrais;
- a propria `docs/25-plano-testes-completo.md` ainda aponta a Fase T4 como pendente.

O objetivo desta task e:

- adicionar testes de pagina/componente de maior valor no `desk-web`;
- reduzir a distancia entre smoke E2E e testes locais de interface;
- melhorar a confianca de manutencao do frontend sem depender sempre do browser full-stack.

## 2. Fonte da Verdade Obrigatoria

Antes de qualquer alteracao, o Codex deve ler:

1. `docs/58-plano-execucao-claude-code-frontend-page-tests.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/25-plano-testes-completo.md`
4. `docs/19-test-strategy.md`
5. `docs/08-frontend-architecture.md`
6. `docs/18-deployment-and-runtime.md`

## 3. Estado Atual a Revalidar no Codigo

O Codex deve confirmar:

- quais testes existem hoje em `apps/desk-web/src/__tests__/`;
- quais paginas centrais existem de fato;
- como `Inbox`, `Kanban` e `Login` dependem de API/store/realtime;
- quais partes podem ser testadas localmente com mocks simples;
- quais seletores ou estruturas estao estaveis o suficiente para testes de componente.

Arquivos/areas para inspecao inicial:

- `apps/desk-web/src/__tests__/`
- `apps/desk-web/src/pages/Inbox.tsx`
- `apps/desk-web/src/pages/Kanban.tsx`
- `apps/desk-web/src/pages/Login.tsx`
- `apps/desk-web/src/lib/api.ts`
- `apps/desk-web/src/store/`

## 4. Objetivo Tecnico da Task

Executar esta task nesta ordem:

1. mapear as paginas centrais ainda sem cobertura;
2. escolher o menor conjunto de testes de alto valor;
3. implementar os testes de componente/pagina;
4. validar localmente;
5. atualizar a documentacao.

## 5. Escopo Obrigatorio

### Frente A — Escolha dos Casos

Priorizar testes para:

1. `Login`
2. `Inbox`
3. `Kanban`

Se o escopo ficar grande demais, garantir no minimo:

- `Login` e `Inbox`;
- `Kanban` como terceiro alvo preferencial.

### Frente B — Tipo de Teste

Preferir testes de componente/pagina com Vitest + React Testing Library.

Casos esperados:

- `Login`: renderizacao, submit, erro e chamada de auth/store;
- `Inbox`: renderizacao base, carregamento de conversas/mensagens mockadas, composer ou estados centrais;
- `Kanban`: renderizacao do board, colunas e leitura de dados mockados.

Evitar transformar esta task em E2E duplicado do Playwright.

### Frente C — Cobertura Minima

Os testes devem provar comportamento util, nao apenas renderizacao vazia.

Exemplos aceitaveis:

- fluxo de carregamento;
- estados de sucesso/erro;
- acao principal do usuario;
- integracao com store/api mockada.

### Frente D — Documentacao

Atualizar no minimo:

- `docs/25-plano-testes-completo.md`
- `docs/19-test-strategy.md`
- `docs/GAPS-TECNICOS.md`

Se necessario:

- `docs/08-frontend-architecture.md`

## 6. Criterios de Aceite

Esta task so pode ser considerada bem-sucedida se:

1. houver novos testes locais de frontend para paginas centrais;
2. os testes cobrirem comportamento util;
3. a documentacao refletir a nova cobertura;
4. o resultado final for honesto sobre o que ainda ficou fora.

## 7. Fora de Escopo

Nao abrir nesta task:

- redesign de paginas;
- refatoracao ampla do frontend;
- cobertura total de todos os componentes;
- novos testes E2E pesados.

## 8. Entregavel Obrigatorio

Ao final, o Codex deve entregar um relatorio contendo:

1. documentos consultados;
2. estado atual confirmado no codigo;
3. paginas/casos escolhidos e justificativa;
4. o que foi implementado;
5. arquivos alterados;
6. testes executados;
7. riscos remanescentes;
8. decisao final:
   - `PRONTO`
   - `PARCIAL`
   - `PENDENTE`

## 9. Instrucao Final

Leia este documento inteiro antes de qualquer alteracao.

Depois:

1. leia os documentos obrigatorios;
2. revalide o estado atual dos testes do `desk-web`;
3. implemente o menor conjunto de testes de paginas centrais com maior valor;
4. execute os testes;
5. atualize a documentacao;
6. entregue o relatorio final no formato deste plano.
