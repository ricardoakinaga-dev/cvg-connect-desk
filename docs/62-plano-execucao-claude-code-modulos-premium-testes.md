# Plano de Execução — Robustez dos Módulos Premium com Testes Reais

**Data:** 2026-04-10  
**Origem:** Fase 1 do `docs/61-plano-executivo-restante-enterprise-premium.md`  
**Objetivo:** Aumentar a robustez dos módulos premium do CVG Connect Desk com o menor conjunto de testes úteis e reais, priorizando risco operacional e maturidade do produto.

---

## 1. Contexto

O projeto já possui:

- backend modular funcional;
- frontend operacional amplo;
- CI mínima útil;
- smoke E2E;
- forte cobertura em chat, events, realtime, webhook e API crítica.

O ponto que ainda puxa a nota para baixo é a maturidade desigual dos módulos premium:

- `labels`
- `sectors`
- `contact-groups`
- `transfers`
- `contacts`

Hoje vários desses módulos têm:

- rotas reais;
- telas reais;
- repositories reais;
- mas cobertura ainda muito estrutural em vez de comportamental/integrada.

---

## 2. Meta Desta Execução

Entregar o **menor pacote de testes com maior valor** para subir a confiança dos módulos premium sem abrir escopo excessivo.

O alvo não é testar tudo. O alvo é validar os fluxos premium mais importantes de ponta a ponta no backend e, quando fizer sentido, refletir isso na documentação.

---

## 3. Prioridade de Escopo

### Prioridade P0

1. `labels`
2. `sectors`
3. `contact-groups`

### Prioridade P1

4. `transfers`
5. `contacts`

Se o ambiente ou tempo não permitir fechar todos, concluir primeiro os três de `P0`.

---

## 4. Estratégia de Implementação

### 4.1 Tipo de teste preferido

Priorizar:

- testes de integração HTTP reais em `apps/desk-api/src/__tests__/`
- Fastify real
- PostgreSQL real

Evitar nesta task:

- excesso de testes puramente estruturais;
- duplicar com smoke Playwright;
- criar mocks complexos quando o fluxo real via API já for viável.

### 4.2 Regra de valor

Cada suíte nova deve cobrir pelo menos um destes pontos:

- CRUD real;
- vínculo entre entidades;
- validação de erro relevante;
- regra operacional crítica;
- comportamento esperado de retorno da API.

---

## 5. Escopo Esperado por Módulo

### 5.1 Labels

Criar ou ampliar suíte de integração real cobrindo:

- listar labels;
- criar label;
- atualizar label;
- vincular label a conversa ou contato;
- remover vínculo;
- falha controlada em input inválido ou entidade inexistente.

### 5.2 Sectors

Criar ou ampliar suíte cobrindo:

- listar setores;
- criar setor;
- atualizar setor;
- buscar stats ou visão operacional do setor;
- erro para setor inexistente quando aplicável.

### 5.3 Contact Groups

Criar ou ampliar suíte cobrindo:

- listar grupos;
- criar grupo;
- adicionar membro;
- remover membro;
- consultar grupos de um contato ou membros do grupo.

### 5.4 Transfers

Se couber no escopo, cobrir:

- criar transferência;
- aceitar;
- rejeitar;
- refletir mudança de estado de forma coerente.

### 5.5 Contacts

Se couber no escopo, cobrir:

- listar contatos;
- criar contato;
- atualizar contato;
- iniciar conversa a partir do contato, se o fluxo estiver maduro o suficiente.

---

## 6. Documentação a Atualizar

Atualizar apenas se a implementação realmente acontecer:

- `docs/25-plano-testes-completo.md`
- `docs/19-test-strategy.md`
- `docs/16-validation-checklist.md`
- `docs/GAPS-TECNICOS.md` se houver redução material do restante do `G-06`

Não marcar como “fechado” o que não tiver sido executado de verdade.

---

## 7. Comandos Esperados de Validação

Exemplos esperados, ajustando ao que for implementado:

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/labels-routes.integration.test.ts
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/sectors-routes.integration.test.ts
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/contact-groups-routes.integration.test.ts
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/transfers-routes.integration.test.ts
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/contacts-routes.integration.test.ts
```

Se o banco local estiver indisponível, registrar isso com honestidade e não vender execução que não ocorreu.

---

## 8. Critério de Conclusão

Esta task será considerada bem-sucedida se entregar:

1. pelo menos `3` suítes novas ou ampliadas de integração real para módulos premium;
2. execução real bem-sucedida dessas suítes;
3. documentação alinhada ao que foi realmente coberto;
4. relatório final honesto distinguindo:
   - o que foi criado;
   - o que foi executado;
   - o que ficou fora.

---

## 9. Formato do Relatório Final

O relatório final deve conter:

1. documentos consultados;
2. estado atual confirmado no código;
3. módulos escolhidos e justificativa;
4. o que foi implementado;
5. arquivos alterados;
6. testes executados com resultado;
7. riscos remanescentes;
8. decisão final (`PRONTO` ou `PARCIAL`).

---

## 10. Resultado Esperado

Ao final desta execução, o projeto deve ganhar:

- mais confiança real nas frentes premium;
- melhor equilíbrio entre breadth e depth da cobertura;
- base melhor para a próxima fase do plano executivo enterprise.

