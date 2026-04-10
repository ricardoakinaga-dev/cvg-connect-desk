# Plano de Execução — Transfers e Contacts com Integração HTTP Real

**Data:** 2026-04-10  
**Origem:** pendência remanescente após auditoria dos planos 62/63  
**Objetivo:** Fechar especificamente a lacuna de integração HTTP real para `transfers` e `contacts` na `desk-api`, usando Fastify real + PostgreSQL real.

---

## 1. Contexto

Os módulos premium já avançaram em duas camadas:

- `labels`, `sectors` e `contact-groups` já ganharam suítes de integração HTTP reais;
- `labels`, `sectors`, `transfers`, `contact-groups`, `contacts` e `dashboard` já ganharam use-case tests comportamentais.

A pendência específica que sobrou é:

- `transfers` com integração HTTP real;
- `contacts` com integração HTTP real.

Esta task existe para fechar essa lacuna sem reabrir escopo em frontend, Playwright ou refactors grandes.

---

## 2. Meta

Entregar duas suítes de integração HTTP reais:

1. `apps/desk-api/src/__tests__/transfers-routes.integration.test.ts`
2. `apps/desk-api/src/__tests__/contacts-routes.integration.test.ts`

com execução real contra PostgreSQL, se o ambiente permitir.

---

## 3. Escopo Obrigatório

### 3.1 Transfers

Cobrir no mínimo:

1. `POST /transfers`
2. `GET /transfers`
3. `GET /contacts/:id/transfers`
4. `POST /transfers/:id/accept`
5. `POST /transfers/:id/reject`

Coberturas esperadas:

- criação válida;
- listagem;
- aceitação;
- rejeição;
- 404 para transferência inexistente;
- coerência de estado após transição.

### 3.2 Contacts

Cobrir no mínimo:

1. `GET /contacts`
2. `GET /contacts/:id`
3. `POST /contacts`
4. `PUT /contacts/:id`
5. `DELETE /contacts/:id`
6. `POST /contacts/:id/start-conversation`
7. `GET /contacts/stats/overview`

Coberturas esperadas:

- criação válida;
- leitura;
- atualização;
- exclusão;
- 404 para contato inexistente;
- início real de conversa a partir do contato;
- overview de stats.

---

## 4. Estratégia

### 4.1 Base técnica

Seguir o mesmo padrão das suítes já maduras de `desk-api`:

- `buildDeskApiApp()`
- `app.inject()`
- autenticação real via `/auth/login`
- seed mínimo local por teste
- cleanup explícito

### 4.2 Regra de implementação

Cada teste novo deve validar:

- status code correto;
- payload coerente;
- efeito real no banco quando aplicável;
- erro relevante quando a entidade não existir ou a transição for inválida.

### 4.3 O que evitar

- não trocar esta task por use-case tests;
- não abrir escopo para frontend;
- não inflar a suíte com cenários marginais demais;
- não mexer em produção code sem necessidade real para viabilizar os testes.

---

## 5. Ambiente

Assumir:

- `DATABASE_URL` funcional;
- migrations aplicadas;
- PostgreSQL acessível;
- padrão dos testes de integração já existente em `apps/desk-api/src/__tests__/`.

Se o ambiente bloquear a execução real, registrar isso com honestidade no relatório final.

---

## 6. Documentação a Atualizar

Atualizar apenas se houver entrega real:

- `docs/25-plano-testes-completo.md`
- `docs/19-test-strategy.md`
- `docs/16-validation-checklist.md`
- `docs/GAPS-TECNICOS.md` se houver redução material do restante do `G-06`

---

## 7. Comandos Esperados

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/transfers-routes.integration.test.ts
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/contacts-routes.integration.test.ts
```

Se o ambiente estiver estável:

```bash
pnpm --filter @cvg/desk-api exec vitest run \
  src/__tests__/transfers-routes.integration.test.ts \
  src/__tests__/contacts-routes.integration.test.ts
```

---

## 8. Critério de Conclusão

Esta task será `PRONTO` apenas se entregar:

1. suíte real de integração para `transfers`;
2. suíte real de integração para `contacts`;
3. execução real explícita das duas;
4. documentação alinhada ao que de fato foi executado.

Se apenas uma suíte for concluída/executada, a decisão deve ser `PARCIAL`.

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

Ao final desta execução, o bloco premium backend ficará coberto por integração HTTP real em:

- `labels`
- `sectors`
- `contact-groups`
- `transfers`
- `contacts`

e a pendência específica aberta na auditoria dos planos anteriores estará encerrada.

