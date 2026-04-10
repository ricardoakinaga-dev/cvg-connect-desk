# Plano de Execução — Integração HTTP Real para Transfers e Contacts

**Data:** 2026-04-10  
**Origem:** continuação do `docs/62-plano-execucao-claude-code-modulos-premium-testes.md`  
**Objetivo:** Fechar o bloco remanescente dos módulos premium com testes de integração HTTP reais para `transfers` e `contacts`, usando Fastify real + PostgreSQL real.

---

## 1. Contexto

O plano 62 fechou os módulos premium `P0`:

- `labels`
- `sectors`
- `contact-groups`

Ficaram fora por escolha consciente de escopo:

- `transfers`
- `contacts`

Esses dois módulos já possuem:

- controllers HTTP reais;
- use cases reais;
- repositories reais;
- valor operacional claro;
- mas ainda carecem de integração HTTP madura equivalente ao bloco já entregue.

---

## 2. Meta Desta Execução

Entregar o menor conjunto de testes de integração reais que feche o pacote premium remanescente da Fase 1, sem expandir escopo para frontend ou E2E.

---

## 3. Escopo Obrigatório

### 3.1 Transfers

Criar ou ampliar suíte de integração real cobrindo:

1. `POST /transfers`
2. `GET /transfers`
3. `GET /contacts/:id/transfers`
4. `POST /transfers/:id/accept`
5. `POST /transfers/:id/reject`

Cobrir também, quando viável:

- 404 para transferência inexistente;
- erro de input inválido;
- coerência de estado após aceitar ou rejeitar.

### 3.2 Contacts

Criar ou ampliar suíte de integração real cobrindo:

1. `GET /contacts`
2. `GET /contacts/:id`
3. `POST /contacts`
4. `PUT /contacts/:id`
5. `DELETE /contacts/:id`
6. `POST /contacts/:id/start-conversation`
7. `GET /contacts/stats/overview`

Cobrir também, quando viável:

- 404 para contato inexistente;
- validação mínima de payload;
- criação real de conversa a partir do contato.

---

## 4. Estratégia

### 4.1 Tipo de teste

Priorizar:

- `apps/desk-api/src/__tests__/transfers-routes.integration.test.ts`
- `apps/desk-api/src/__tests__/contacts-routes.integration.test.ts`
- `buildDeskApiApp()`
- `app.inject()`
- PostgreSQL real

### 4.2 Regra de implementação

Cada suíte deve validar:

- comportamento real da rota;
- integração com banco;
- status code correto;
- payload de resposta coerente;
- pelo menos um cenário de erro relevante.

### 4.3 O que não fazer nesta task

- não migrar para Playwright;
- não criar mocks complexos desnecessários;
- não abrir escopo para refatorações grandes se a rota atual já estiver funcional;
- não reescrever módulos fora do necessário para testes passarem.

---

## 5. Dependências e Ambiente

Esta task assume:

- `DATABASE_URL` funcional;
- migrations aplicadas;
- padrão de autenticação já usado nos testes de integração existentes;
- possibilidade de usar as fixtures/padrões já presentes em `apps/desk-api/src/__tests__/`.

Se o ambiente impedir execução real por ausência de banco, documentar isso com honestidade.

---

## 6. Documentação a Atualizar

Atualizar somente se houver entrega real:

- `docs/25-plano-testes-completo.md`
- `docs/19-test-strategy.md`
- `docs/16-validation-checklist.md`
- `docs/GAPS-TECNICOS.md` se houver redução material do restante do `G-06`

---

## 7. Comandos Esperados

Exemplos esperados:

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/transfers-routes.integration.test.ts
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/contacts-routes.integration.test.ts
```

Se fizer sentido e o ambiente estiver estável:

```bash
pnpm --filter @cvg/desk-api exec vitest run \
  src/__tests__/transfers-routes.integration.test.ts \
  src/__tests__/contacts-routes.integration.test.ts
```

---

## 8. Critério de Conclusão

Esta task será considerada concluída com sucesso se entregar:

1. suíte de integração real para `transfers`;
2. suíte de integração real para `contacts`;
3. execução real das suítes com resultado explícito;
4. documentação alinhada ao que foi realmente coberto.

Se apenas uma suíte for entregue e executada, a decisão final deve ser `PARCIAL`.

---

## 9. Formato do Relatório Final

O relatório final deve conter:

1. documentos consultados;
2. estado atual confirmado no código;
3. o que foi implementado;
4. arquivos alterados;
5. testes executados com resultado;
6. riscos remanescentes;
7. decisão final (`PRONTO` ou `PARCIAL`).

---

## 10. Resultado Esperado

Ao final desta execução, a Fase 1 do plano executivo enterprise deve ficar muito próxima de encerramento, com o bloco premium backend coberto por integração real em:

- `labels`
- `sectors`
- `contact-groups`
- `transfers`
- `contacts`

