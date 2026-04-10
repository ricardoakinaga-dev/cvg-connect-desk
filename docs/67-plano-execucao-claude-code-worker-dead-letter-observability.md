# Plano de Execução — Observabilidade Operacional de Worker, Dead-Letter e Webhook

**Data:** 2026-04-10  
**Origem:** continuação do `docs/66-plano-execucao-claude-code-observabilidade-governanca.md`  
**Objetivo:** Entregar um primeiro corte concreto de observabilidade e governança com maior valor operacional imediato, focado em `message-worker`, `dead-letter` e `webhook`.

---

## 1. Contexto

O sistema já possui:

- `message-worker` funcional com handlers reais;
- `dead-letter` operacional no admin;
- retry contextual com `sourceEvent` no worker;
- webhook endurecido para produção;
- documentação técnica mais alinhada ao código.

O que ainda falta para um nível enterprise melhor é tornar mais explícito:

- o que falhou;
- onde falhou;
- como investigar;
- o que o operador consegue inferir rapidamente a partir do sistema.

---

## 2. Meta

Entregar o menor pacote útil de observabilidade real para:

1. falhas terminais do worker;
2. entradas de dead-letter;
3. comportamento do webhook em cenários críticos;
4. documentação operacional correspondente.

---

## 3. Escopo Prioritário

### 3.1 Worker

Melhorar a evidência operacional das falhas terminais:

- contexto mais claro de `eventType`, `eventId`, handler e motivo;
- garantir que a informação útil de triagem fique acessível;
- testar o comportamento novo.

### 3.2 Dead-letter

Melhorar a governança do registro:

- tornar mais claro no payload/entry o motivo da falha;
- garantir coerência entre retry, resolve e contexto salvo;
- melhorar a legibilidade operacional do que chega ao admin.

### 3.3 Webhook

Melhorar observabilidade sem reduzir segurança:

- diferenciar melhor misconfiguration, assinatura inválida e sucesso;
- garantir que os sinais documentados realmente batem com o comportamento do runtime;
- adicionar teste útil se houver mudança comportamental.

---

## 4. Estratégia

### 4.1 O que vale como entrega útil

Aceitam-se melhorias como:

- campos adicionais de contexto em dead-letter;
- mensagens de erro mais padronizadas;
- logs operacionais mais claros;
- testes cobrindo a governança do fluxo;
- documentação de triagem e operação.

### 4.2 O que não fazer

- não criar observabilidade dependente de ferramenta externa não presente no repo;
- não inventar métricas sem dado confiável;
- não abrir escopo para refatoração grande de worker;
- não mexer no fluxo de negócio sem justificativa operacional clara.

---

## 5. Áreas Prováveis de Código

Avaliar e trabalhar onde fizer mais sentido:

- `apps/message-worker/src/index.ts`
- `apps/message-worker/src/dead-letter.ts`
- `packages/events/src/dead-letter.ts`
- `modules/admin/src/presentation/http/admin.controller.ts`
- `packages/shared/src/webhook-guard.ts`
- `apps/desk-api/src/app.ts`

Testes prováveis:

- `apps/message-worker/src/__tests__/dead-letter.test.ts`
- `packages/events/src/__tests__/dead-letter.test.ts`
- `apps/desk-api/src/__tests__/webhook-inbound.integration.test.ts`
- `packages/shared/src/__tests__/webhook-guard.test.ts`

---

## 6. Documentação a Atualizar

Atualizar conforme a entrega real:

- `docs/12-audit-and-observability.md`
- `docs/18-deployment-and-runtime.md`
- `docs/11-security-and-access-control.md`
- `docs/GAPS-TECNICOS.md`

Se houver impacto em testes:

- `docs/19-test-strategy.md`
- `docs/25-plano-testes-completo.md`

---

## 7. Critério de Conclusão

Esta task será `PRONTO` se entregar:

1. pelo menos uma melhoria concreta e útil de observabilidade em `worker/dead-letter/webhook`;
2. teste útil cobrindo o comportamento novo, quando aplicável;
3. documentação operacional alinhada;
4. relato claro do ganho operacional obtido.

Se ficar só em análise ou documentação sem mudança real, a decisão deve ser `PARCIAL`.

---

## 8. Formato do Relatório Final

O relatório final deve conter:

1. documentos consultados;
2. estado atual confirmado no código;
3. área escolhida e justificativa;
4. o que foi implementado;
5. arquivos alterados;
6. testes executados com resultado;
7. riscos remanescentes;
8. decisão final (`PRONTO` ou `PARCIAL`).

---

## 9. Resultado Esperado

Ao final desta execução, o time deve ganhar:

- melhor visibilidade de falhas terminais;
- dead-letter mais útil para triagem real;
- comportamento de webhook mais inteligível operacionalmente;
- documentação melhor para uso enterprise.

