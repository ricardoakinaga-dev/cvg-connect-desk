# Plano de Execução — Reconciliação Final da Fase 2

**Data:** 2026-04-10  
**Origem:** fechamento da Fase 2 de observabilidade/governança após auditoria  
**Objetivo:** Encerrar a Fase 2 sem ambiguidade, reconciliando a documentação central, formalizando a política de métricas de runtime e deixando claro o que está realmente concluído.

---

## 1. Contexto

A Fase 2 avançou de forma real com:

- logs estruturados em worker e realtime;
- dead-letter com contexto operacional melhor;
- webhook com `reason` explícito;
- endpoints e testes úteis de governança (`/admin/dead-letters/stats`, `webhook-security stats`);
- documentação setorial atualizada.

Mas a auditoria mostrou que ainda existe ruído na narrativa executiva:

1. `docs/GAPS-TECNICOS.md` ainda contém inconsistências históricas na priorização executiva;
2. a política sobre métricas de runtime (`/metrics/worker`, `/metrics/realtime`) ainda não está formalmente encerrada;
3. a fase pode ser interpretada como “fechada” ou “parcial” dependendo do documento que se lê.

Esta task existe para resolver exatamente essa ambiguidade.

---

## 2. Meta

Ao final desta execução, deve existir uma leitura única e honesta para a Fase 2:

- o que foi entregue;
- o que foi explicitamente descartado;
- o que continua futuro;
- e qual é a decisão final correta para a fase.

---

## 3. Escopo Obrigatório

### 3.1 Limpar inconsistências em `docs/GAPS-TECNICOS.md`

Revisar e corrigir pelo menos:

- referências executivas antigas que já não batem com o código;
- priorização que ainda trate gap já mitigado como crítico;
- linguagem que misture estado histórico com estado atual;
- descrição de `G-06` e dos gaps de observabilidade para refletir o estado real.

### 3.2 Formalizar a política de métricas de runtime

Tomar uma decisão explícita e documentada sobre:

- `GET /metrics/worker`
- `GET /metrics/realtime`

Opções válidas:

1. **Implementar** endpoints leves e sustentáveis agora;
2. **Descartar por decisão arquitetural explícita**, definindo que logs estruturados + probes nativos são a superfície operacional oficial nesta fase.

Não deixar esse ponto implícito.

### 3.3 Encerrar a Fase 2 sem ambiguidade

Atualizar a documentação para que a leitura final da fase fique inequívoca:

- `PRONTO`, se os critérios realmente forem satisfeitos;
- `PARCIAL`, se ainda restar algo material.

Essa decisão precisa ser sustentada por:

- código;
- documentação;
- e, quando houver mudança real, testes.

---

## 4. Documentos a Revisar

No mínimo:

- `docs/GAPS-TECNICOS.md`
- `docs/12-audit-and-observability.md`
- `docs/18-deployment-and-runtime.md`
- `docs/19-test-strategy.md`
- `docs/61-plano-executivo-restante-enterprise-premium.md`

Se fizer sentido:

- `docs/60-relatorio-consolidado-estado-construcao-cvg-connect-desk.md`

---

## 5. Estratégia

### 5.1 Regra principal

Não implementar nada novo sem necessidade.

Esta task é de:

- reconciliação;
- decisão explícita;
- limpeza de ambiguidade.

### 5.2 Quando código pode mudar

Código só deve mudar se a decisão sobre métricas de runtime exigir:

- criar endpoint mínimo real; ou
- remover/ajustar algo que contradiga a política final.

Se não houver necessidade técnica real, a entrega pode ser predominantemente documental.

---

## 6. Critério de Conclusão

Esta task será `PRONTO` apenas se:

1. `docs/GAPS-TECNICOS.md` ficar coerente com o estado real do código;
2. a política de métricas de runtime ficar explicitamente decidida;
3. a leitura final da Fase 2 ficar unificada entre os documentos centrais;
4. não restar ambiguidade executiva sobre o status da fase.

Se ainda houver documentos centrais puxando a fase para leituras conflitantes, a decisão deve ser `PARCIAL`.

---

## 7. Formato do Relatório Final

O relatório final deve conter:

1. documentos consultados;
2. inconsistências encontradas;
3. decisão tomada para métricas de runtime;
4. o que foi atualizado;
5. arquivos alterados;
6. testes executados, se houver;
7. decisão final (`PRONTO` ou `PARCIAL`).

---

## 8. Resultado Esperado

Ao final desta execução:

- a Fase 2 deixa de depender de interpretação;
- os documentos centrais convergem;
- e o projeto volta a ter uma linha executiva limpa para a próxima fase.

