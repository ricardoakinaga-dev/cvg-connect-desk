# Plano de Execucao — Playwright Smoke E2E

**Documento:** Plano de trabalho para reduzir o restante do G-06 com setup minimo de Playwright e smoke E2E
**Data:** 2026-04-10
**Status:** Ativo
**Fonte da verdade:** `/docs`

---

## 1. Objetivo

Este plano existe para atacar o restante do G-06:

- setup minimo de Playwright;
- smoke E2E inicial;
- validacao de fluxos criticos com o menor escopo viavel.

O objetivo desta task nao e construir uma suite E2E completa do produto.
O objetivo e instalar a base minima correta e entregar os primeiros smoke tests realmente uteis.

---

## 2. Fonte da Verdade Obrigatoria

O Claude Code deve ler primeiro:

1. `docs/39-plano-execucao-claude-code-playwright-smoke.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/25-plano-testes-completo.md`
4. `docs/19-test-strategy.md`
5. `docs/16-validation-checklist.md`
6. `docs/18-deployment-and-runtime.md`

Regras:

- usar `/docs` como fonte da verdade;
- validar o estado atual do repositorio antes de implementar;
- manter o escopo pequeno, funcional e executavel;
- nao inflar conclusao se os testes dependerem de ambiente que nao esteja disponivel.

---

## 3. Estado Atual Consolidado

Com base na documentacao e no repositorio:

- G-06 continua parcial;
- as tres frentes prioritarias de comportamento ja avancaram:
  - idempotencia inbound;
  - webhook security;
  - realtime auth behavior;
- o que resta mais explicitamente pendente em `/docs` e:
  - setup de Playwright;
  - smoke E2E inicial.

Segundo `docs/25-plano-testes-completo.md`, os smoke tests esperados sao:

1. login flow
2. send message
3. create task
4. kanban drag-drop

---

## 4. Objetivo Tecnico da Task

O Claude Code deve executar esta task nesta ordem:

1. instalar/configurar Playwright no monorepo;
2. definir a menor estrategia de execucao local segura;
3. criar smoke tests iniciais;
4. documentar o que foi possivel executar de fato;
5. atualizar a documentacao ao final.

---

## 5. Escopo Obrigatorio

### Frente A — Setup Minimo de Playwright

Implementar a base minima necessaria para o repositorio suportar smoke E2E.

Esperado:

- dependencia(s) de Playwright instaladas;
- arquivo de configuracao criado;
- script(s) de execucao no `package.json` apropriado;
- convencao de pasta para testes E2E;
- configuracao minima de baseURL e timeout.

O setup deve ser simples e coerente com o monorepo.

### Frente B — Smoke Tests Iniciais

O Claude Code deve priorizar estes cenarios, nesta ordem:

1. **Login flow**
2. **Create task**
3. **Send message**
4. **Kanban drag-drop**

Se nao for viavel entregar todos, a prioridade minima aceitavel e:

- login flow
- create task

Os testes devem ser:

- realmente E2E ou o mais proximo disso;
- focados em happy path;
- simples de manter;
- explicitamente marcados como smoke.

### Frente C — Estrategia de Ambiente

O Claude Code deve decidir e documentar:

- quais servicos precisam estar rodando;
- como preparar o ambiente;
- se vai usar `docker-compose.dev.yml` ou outro caminho ja existente;
- se os testes conseguem rodar no ambiente atual ou apenas ficam preparados.

Regras:

- se nao for possivel executar de fato, isso deve ser dito claramente;
- nao marcar como concluido algo que so foi scaffoldado;
- o setup deve deixar claro o comando de execucao para outro engineer.

### Frente D — Documentacao

Ao final, atualizar:

1. `docs/GAPS-TECNICOS.md`
2. `docs/25-plano-testes-completo.md`

E, se necessario:

3. `docs/19-test-strategy.md`
4. `docs/16-validation-checklist.md`

Regras:

- se Playwright ficar apenas configurado, documentar isso como parcial;
- se smoke tests forem criados mas nao executados, documentar isso claramente;
- se pelo menos um smoke real rodar, atualizar o estado com precisao.

---

## 6. Fora de Escopo

Nao faz parte desta task:

- cobertura completa de todos os fluxos do produto;
- matrix cross-browser ampla;
- testes visuais sofisticados;
- pipeline CI completo de Playwright;
- refatoracao da aplicacao para torná-la testavel, salvo pequenos ajustes estritamente necessarios.

---

## 7. Arquivos a Inspecionar Primeiro

### Infra / Runtime

- `docker-compose.dev.yml`
- `docker-compose.yml`
- `package.json`
- `pnpm-workspace.yaml`

### Frontend / App

- `apps/desk-web`
- rotas principais de login, inbox, kanban, task flow

### API / Runtime

- `apps/desk-api`
- qualquer endpoint necessario para bootstrap de ambiente de teste

### Documentacao

- `docs/25-plano-testes-completo.md`
- `docs/GAPS-TECNICOS.md`

---

## 8. Criterios de Aceite

Esta task so pode ser considerada bem sucedida se:

1. existir setup real de Playwright no repositorio;
2. houver ao menos smoke tests iniciais implementados;
3. ficar claro como executar esses testes;
4. o relatorio diferenciar:
   - configurado
   - implementado
   - executado
5. a documentacao for atualizada com honestidade.

Se apenas o setup for criado mas os testes nao rodarem, o status deve ser `PARCIAL`.

---

## 9. Entregavel Obrigatorio

Ao final, o Claude Code deve entregar:

1. documentos consultados;
2. estado atual confirmado no codigo;
3. estrategia de setup escolhida;
4. o que foi implementado;
5. arquivos alterados;
6. smoke tests criados;
7. comandos de execucao;
8. o que foi de fato executado;
9. ambiente usado;
10. ajustes feitos na documentacao;
11. riscos remanescentes;
12. decisao final:
   - `PRONTO`
   - `PARCIAL`
   - `PENDENTE`

---

## 10. Instrucao Final

Leia este documento inteiro, depois releia os documentos listados na secao 2, valide o estado atual no codigo e execute a task completa.

Nao entregue apenas analise.

Configure Playwright, implemente smoke E2E minimo, execute o que for viavel e atualize a documentacao ao final.
