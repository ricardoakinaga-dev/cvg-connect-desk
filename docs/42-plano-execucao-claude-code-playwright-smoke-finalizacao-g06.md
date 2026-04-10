# Plano de Execucao — Playwright Smoke e Finalizacao do G-06

Data: 2026-04-10
Status: Ativo
Escopo: Fechar a proxima frente util do projeto com setup real de Playwright e smoke E2E minimo

## 1. Objetivo

Executar a proxima rodada de trabalho focada em reduzir o restante real do G-06.

O objetivo desta task e:

- instalar e configurar a base minima de Playwright no monorepo;
- criar smoke tests E2E realmente uteis;
- validar ao menos o caminho minimo de uso do produto;
- atualizar a documentacao com honestidade sobre o que foi configurado, implementado e executado.

Nao e objetivo desta task construir uma suite E2E completa.

## 2. Fonte da Verdade Obrigatoria

Antes de qualquer alteracao, o Claude Code deve ler:

1. `docs/42-plano-execucao-claude-code-playwright-smoke-finalizacao-g06.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/25-plano-testes-completo.md`
4. `docs/19-test-strategy.md`
5. `docs/16-validation-checklist.md`
6. `docs/18-deployment-and-runtime.md`
7. `docs/21-instalacao-local.md`

Regras:

- usar `/docs` como fonte da verdade;
- revalidar no codigo o estado atual antes de implementar;
- manter o escopo minimo, executavel e sustentavel;
- nao marcar como concluido o que tiver sido apenas scaffoldado.

## 3. Estado Atual Consolidado

O repositorio ja avancou em:

- testes comportamentais de webhook security;
- testes comportamentais de realtime auth;
- testes integrados de idempotencia inbound;
- testes integrados HTTP/API de auth, chat, events polling, webhook inbound e kanban;
- testes integrados de Secretary/handoff.

O que continua explicitamente pendente na documentacao:

- Playwright nao instalado;
- smoke E2E ainda inexistente;
- G-06 segue parcial por falta da camada browser/E2E.

## 4. Objetivo Tecnico da Task

O Claude Code deve executar esta task na seguinte ordem:

1. mapear como subir o ambiente minimo para E2E;
2. instalar/configurar Playwright no ponto certo do monorepo;
3. criar a base minima de fixtures e setup;
4. implementar smoke tests com prioridade correta;
5. executar o que for viavel no ambiente atual;
6. atualizar a documentacao com precisao.

## 5. Prioridade de Entrega

### Prioridade minima obrigatoria

1. **Login flow**
2. **Inbox carregando autenticada**

### Prioridade secundaria

3. **Send message**
4. **Kanban abre e renderiza**

### Opcional, se o ambiente permitir sem inflar escopo

5. **Create task**
6. **Kanban interaction basica**

Se o ambiente nao suportar tudo, o minimo aceitavel desta task e:

- setup real de Playwright;
- smoke de login;
- smoke de inbox autenticada;
- documentacao clara de execucao.

## 6. Escopo Obrigatorio

### 6.1 Setup Minimo de Playwright

Esperado:

- dependencia de Playwright instalada no local correto;
- configuracao criada;
- pasta de testes E2E definida;
- scripts de execucao adicionados;
- timeouts/baseURL/trace configurados de forma simples;
- possibilidade clara de rodar localmente.

O setup deve respeitar a estrutura do monorepo e evitar complexidade desnecessaria.

### 6.2 Estrategia de Ambiente

O Claude Code deve decidir e documentar:

- quais servicos precisam estar rodando;
- se o ambiente ideal usa `docker-compose.dev.yml`;
- como preparar `DATABASE_URL`, API e web;
- se os testes usam login real pela UI, estado preseedado, ou fixture segura equivalente.

Se for necessario criar utilitarios minimos de bootstrap para o ambiente de teste, isso e permitido, desde que:

- o escopo continue pequeno;
- os ajustes sejam claramente justificados;
- a documentacao explique como usar.

### 6.3 Smoke Tests Reais

Os testes devem ser browser-driven e nao apenas integração HTTP.

Casos obrigatorios:

1. **Login flow**
   - abrir a aplicacao;
   - preencher credenciais;
   - autenticar com sucesso;
   - confirmar chegada ao shell autenticado.

2. **Inbox autenticada**
   - apos login, abrir a inbox;
   - confirmar que a area principal carrega sem quebrar;
   - validar algum marcador minimo de UI operacional.

Casos desejaveis, se o ambiente permitir:

3. **Send message**
   - abrir conversa seeded ou fixture equivalente;
   - enviar mensagem;
   - confirmar reflexo minimo na UI ou resposta da aplicacao.

4. **Kanban smoke**
   - abrir a tela;
   - confirmar renderizacao dos cards/colunas principais.

Importante:

- os testes devem ser smoke, happy-path e faceis de manter;
- se houver necessidade de dados seeded, documentar claramente como foram criados;
- evitar coupling desnecessario com detalhes volateis da UI.

## 7. Fora de Escopo

Nao abrir nesta task:

- suite E2E completa do produto;
- cobertura cross-browser ampla;
- testes visuais;
- pipeline CI completo de Playwright;
- refatoracoes grandes no frontend;
- automacao sofisticada de fixtures se um setup simples resolver.

## 8. Arquivos a Inspecionar Primeiro

### Infra

- `package.json`
- `pnpm-workspace.yaml`
- `docker-compose.dev.yml`
- `docs/21-instalacao-local.md`

### Frontend

- `apps/desk-web`
- rotas de login e inbox
- componentes/paginas de kanban e chat

### API

- `apps/desk-api`
- endpoints necessarios para bootstrap minimo

### Testes

- qualquer configuracao Vitest ja existente que ajude a padronizar scripts;
- possiveis helpers de ambiente nos testes de integracao ja escritos.

## 9. Criterios de Aceite

Esta task so pode ser considerada bem-sucedida se:

1. houver setup real de Playwright no repositorio;
2. houver pelo menos smoke tests minimos implementados;
3. existir comando claro de execucao;
4. ficar claro o ambiente necessario;
5. o relatorio diferenciar:
   - configurado;
   - implementado;
   - executado;
6. a documentacao refletir exatamente o estado final.

Se os testes forem criados mas nao puderem ser executados no ambiente atual, a decisao final deve ser `PARCIAL`.

## 10. Ajustes Documentais Obrigatorios

Ao final, revisar e atualizar:

1. `docs/GAPS-TECNICOS.md`
2. `docs/25-plano-testes-completo.md`

Se necessario:

3. `docs/19-test-strategy.md`
4. `docs/16-validation-checklist.md`
5. `docs/21-instalacao-local.md`

Regras:

- se Playwright for apenas configurado, registrar como parcial;
- se smoke real rodar, registrar exatamente qual fluxo rodou;
- se o ambiente ainda exigir preparo manual, deixar isso explicito.

## 11. Entregavel Obrigatorio

Ao final, o Claude Code deve entregar um relatorio contendo:

1. documentos consultados;
2. estado atual confirmado no codigo;
3. estrategia de setup escolhida;
4. o que foi implementado;
5. arquivos alterados;
6. smoke tests criados;
7. comandos de execucao;
8. o que foi realmente executado;
9. ambiente usado;
10. ajustes feitos na documentacao;
11. riscos remanescentes;
12. decisao final:
   - `PRONTO`
   - `PARCIAL`
   - `PENDENTE`

## 12. Instrucao Final

Leia este documento inteiro antes de qualquer alteracao.

Depois:

1. leia os documentos obrigatorios;
2. revalide o estado atual no codigo;
3. implemente o setup minimo de Playwright;
4. escreva os smoke tests prioritarios;
5. execute o que for viavel no ambiente atual;
6. atualize a documentacao;
7. entregue o relatorio final no formato definido aqui.
