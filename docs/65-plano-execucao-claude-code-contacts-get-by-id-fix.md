# Plano de Execução — Fechamento Final de `GET /contacts/:id`

**Data:** 2026-04-10  
**Origem:** auditoria do `docs/64-plano-execucao-claude-code-transfers-contacts-http-real.md`  
**Objetivo:** Fechar o último ponto pendente do módulo `contacts`: validar de forma real o endpoint `GET /contacts/:id` e remover o `skip` da suíte de integração.

---

## 1. Contexto

Após a execução do plano 64:

- a suíte de `transfers` ficou em bom estado;
- a suíte de `contacts` avançou bastante;
- mas o caso central `GET /contacts/:id` continua `skipado`.

A auditoria confirmou que:

- o arquivo `apps/desk-api/src/__tests__/contacts-routes.integration.test.ts` existe;
- o caso de `GET /contacts/:id` ainda está marcado como `it.skip(...)`;
- o repositório `modules/contacts/src/infrastructure/repositories/contact.repository.ts` já recebeu um ajuste parcial para listas vazias;
- ainda falta a confirmação final de que o endpoint funciona ponta a ponta no cenário real do teste.

Esta task existe para fechar exatamente esse buraco, sem reabrir escopo em outras áreas.

---

## 2. Meta

Entregar:

1. correção real do que ainda estiver quebrando em `GET /contacts/:id`;
2. remoção do `skip` do teste correspondente;
3. execução real da suíte de `contacts`;
4. documentação ajustada apenas se a pendência for realmente encerrada.

---

## 3. Escopo Obrigatório

### 3.1 Corrigir `ContactRepository.getWithDetails()`

Auditar e corrigir o que ainda impedir o fluxo real do endpoint:

- consultas com lista vazia;
- queries auxiliares derivadas de conversas;
- contagem de notes/tasks;
- joins ou subqueries que possam quebrar quando o contato tem zero ou múltiplas conversas.

### 3.2 Des-skipar o teste real

No arquivo:

- `apps/desk-api/src/__tests__/contacts-routes.integration.test.ts`

fazer o caso abaixo voltar a rodar:

- `GET /contacts/:id` retorna `200`

e validar o payload de resposta real de forma coerente.

### 3.3 Executar a suíte

Executar de verdade:

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/contacts-routes.integration.test.ts
```

Se o ambiente permitir, usar `DATABASE_URL` explícito para a stack smoke/PostgreSQL real.

---

## 4. O que não fazer

- não abrir escopo para refatorar todo o módulo de contatos;
- não mexer em outras suítes sem necessidade;
- não vender como concluído se o teste continuar `skipado`;
- não tratar correção parcial como fechamento total.

---

## 5. Documentação a Atualizar

Atualizar apenas se o caso realmente for fechado:

- `docs/25-plano-testes-completo.md`
- `docs/GAPS-TECNICOS.md`

Se a correção não fechar o teste de ponta a ponta, documentar honestamente como `PARCIAL`.

---

## 6. Critério de Conclusão

Esta task será `PRONTO` apenas se:

1. `GET /contacts/:id` funcionar no teste real;
2. o `skip` for removido;
3. a suíte de `contacts` rodar com sucesso;
4. o relatório final mostrar claramente esse fechamento.

Se o teste continuar `skipado` ou falhando, a decisão deve ser `PARCIAL`.

---

## 7. Formato do Relatório Final

O relatório final deve conter:

1. documentos consultados;
2. causa raiz encontrada;
3. o que foi corrigido;
4. arquivos alterados;
5. testes executados com resultado;
6. riscos remanescentes;
7. decisão final (`PRONTO` ou `PARCIAL`).

---

## 8. Resultado Esperado

Ao final desta execução:

- `contacts-routes.integration.test.ts` deve ficar plenamente executável;
- a pendência específica auditada no plano 64 deve ser encerrada;
- o bloco premium backend ficará mais consistente e sem falso positivo de conclusão.

