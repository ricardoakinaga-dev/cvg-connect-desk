# Plano de Execução — Redução dos Riscos Residuais de Observabilidade

**Data:** 2026-04-10  
**Origem:** riscos remanescentes identificados após o plano 67  
**Objetivo:** Reduzir três riscos residuais concretos da frente de observabilidade/governança sem abrir escopo excessivo.

---

## 1. Riscos a Reduzir

### Risco 1 — `failureContext` depende de dead-letter existente

Hoje o `failureContext` melhora bastante a triagem, mas seu valor operacional ainda depende do evento já ter virado dead-letter. Isso ajuda no tratamento, mas ainda deixa o runtime sem uma superfície mais imediata de visibilidade consolidada.

### Risco 2 — `reason` do webhook ainda depende de consumo manual

O webhook já retorna `reason` consistente (`missing_secret`, `missing_signature`, `invalid_signature_format`, `invalid_signature`), mas o reaproveitamento operacional desses sinais ainda está difuso.

### Risco 3 — `webhook-guard.js` espelhado manualmente

Existe uma cópia `.js` do guard para compatibilidade de runtime. Isso funciona, mas é frágil: se a estratégia de build/import mudar, a duplicação manual pode virar fonte de drift.

---

## 2. Meta

Entregar um corte pequeno e útil que:

1. dê uma superfície operacional mínima para estados e contagens relevantes de falha;
2. torne os `reason` do webhook reaproveitáveis de forma explícita;
3. elimine ou reduza a fragilidade de manutenção da cópia manual `.js` do guard.

---

## 3. Escopo Prioritário

### 3.1 Superfície operacional mínima para dead-letter/worker

Implementar ou consolidar:

- endpoint leve de stats operacionais do dead-letter, se ainda faltar;
- ou métrica/endpoint mínimo do worker com informação útil de triagem;
- documentação de como interpretar esse dado.

O alvo é reduzir a dependência de inspeção manual item a item.

### 3.2 Consumo operacional explícito de `reason` do webhook

Escolher o corte mais útil e de menor risco entre:

- consolidar o contrato de resposta/diagnóstico no backend;
- expor isso de forma clara em endpoint/admin/runtime docs;
- reforçar integração/teste para garantir que esses `reason` sejam consumíveis e estáveis.

### 3.3 Eliminar fragilidade da cópia `webhook-guard.js`

Auditar a necessidade real da cópia `.js`:

- se ela puder ser removida com segurança, remover;
- se não puder, criar um caminho menos frágil de manutenção;
- documentar claramente o porquê da escolha.

Não deixar esse ponto como “copiar manualmente e torcer”.

---

## 4. Estratégia

### 4.1 Princípios

- priorizar ganho operacional real;
- preferir soluções pequenas e sustentáveis;
- não inventar tracing distribuído completo nesta task;
- não marcar risco como resolvido se ele só foi reescrito em documentação.

### 4.2 O que vale como boa entrega

Aceitam-se entregas como:

- endpoint `/admin/dead-letters/stats` útil e testado;
- endpoint leve `/metrics/worker` ou equivalente;
- contrato estável do webhook com teste de resposta/`reason`;
- remoção do `.js` duplicado ou substituição por fluxo mais seguro.

---

## 5. Áreas Prováveis de Código

- `modules/admin/src/presentation/http/admin.controller.ts`
- `packages/events/src/dead-letter.ts`
- `apps/message-worker/src/index.ts`
- `packages/shared/src/webhook-guard.ts`
- `packages/shared/src/webhook-guard.js`
- `apps/desk-api/src/app.ts`
- testes em:
  - `apps/desk-api/src/__tests__/dead-letter-routes.integration.test.ts`
  - `apps/desk-api/src/__tests__/webhook-inbound.integration.test.ts`
  - `packages/shared/src/__tests__/webhook-guard.test.ts`
  - testes novos para endpoint de stats/métricas se necessário

---

## 6. Documentação a Atualizar

Atualizar conforme a entrega real:

- `docs/12-audit-and-observability.md`
- `docs/18-deployment-and-runtime.md`
- `docs/11-security-and-access-control.md`
- `docs/GAPS-TECNICOS.md`
- `docs/19-test-strategy.md`
- `docs/25-plano-testes-completo.md`

---

## 7. Critério de Conclusão

Esta task será `PRONTO` apenas se reduzir de forma concreta os três riscos:

1. visibilidade operacional melhor para dead-letter/worker;
2. consumo de `reason` do webhook mais explícito e estável;
3. risco do `webhook-guard.js` manual eliminado ou fortemente mitigado.

Se um ou mais desses pontos continuarem essencialmente iguais, a decisão deve ser `PARCIAL`.

---

## 8. Formato do Relatório Final

O relatório final deve conter:

1. documentos consultados;
2. estado atual confirmado no código;
3. decisão tomada para cada um dos 3 riscos;
4. o que foi implementado;
5. arquivos alterados;
6. testes executados com resultado;
7. riscos remanescentes;
8. decisão final (`PRONTO` ou `PARCIAL`).

---

## 9. Resultado Esperado

Ao final desta execução:

- a observabilidade operacional fica menos dependente de leitura manual;
- o webhook passa a ter contrato mais reaproveitável operacionalmente;
- a compatibilidade de runtime do guard deixa de depender de duplicação frágil.

