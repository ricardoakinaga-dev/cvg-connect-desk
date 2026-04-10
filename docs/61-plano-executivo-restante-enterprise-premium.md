# Plano Executivo — Restante para Enterprise Premium

**Data:** 2026-04-10  
**Base:** `docs/60-relatorio-consolidado-estado-construcao-cvg-connect-desk.md`  
**Objetivo:** Transformar o backlog remanescente em uma sequência executável, numerada e priorizada para levar o CVG Connect Desk do estado atual ao patamar de **Enterprise Premium**.

---

## 1. Premissa de Leitura

O projeto **não está começando do zero**.

Este plano assume que já existem:

- backend modular funcional;
- frontend operacional amplo;
- autenticação real e RBAC;
- eventos/outbox/worker/realtime ativos;
- Secretary integrada;
- smoke E2E e CI mínima útil.

Portanto, este plano foca em **acabamento premium, profundidade, robustez e governança**, não em reconstrução da base.

---

## 2. Objetivo Executivo

Levar o CVG Connect Desk do estado consolidado atual (`84/100`) para uma faixa de **`92+/100`**, com foco em:

1. robustez e cobertura enterprise;
2. observabilidade e governança operacional;
3. amadurecimento das frentes premium de negócio;
4. prontidão de operação e deploy.

---

## 3. Ordem Executiva Recomendada

```text
Fase 1 -> Robustez e Cobertura
Fase 2 -> Observabilidade e Governança
Fase 3 -> Premium de Produto
Fase 4 -> Runtime, Deploy e Operação
Fase 5 -> Consolidação Final Enterprise Premium
```

Regra:

- não pular Fase 1;
- não expandir muito produto premium sem elevar segurança de regressão;
- não chamar o projeto de “Enterprise Premium” antes da Fase 4 estar substancialmente concluída.

---

## 4. Fase 1 — Robustez e Cobertura

**Prioridade:** `P0`  
**Meta:** reduzir o restante real do `G-06`

### 4.1 Objetivos

- expandir cobertura dos módulos menos protegidos;
- fechar lacunas críticas de regressão;
- fortalecer testes de páginas e fluxos premium;
- tornar a base de qualidade proporcional ao tamanho atual do produto.

### 4.2 Escopo

1. ampliar testes de módulos ainda majoritariamente estruturais:
   - `labels`
   - `sectors`
   - `transfers`
   - `contact-groups`
   - `contacts`
   - `dashboard`
2. ampliar integração HTTP para superfícies administrativas e premium;
3. expandir page tests do `desk-web` para páginas secundárias relevantes;
4. manter o smoke E2E enxuto, mas cobrir novos riscos reais apenas quando houver valor operacional.

### 4.3 Critério de Saída

- módulos premium principais com cobertura útil além de teste estrutural;
- regressões centrais mais prováveis protegidas;
- `G-06` rebaixado para residual baixo ou formalmente encerrado.

### 4.4 Nota Esperada Após a Fase

- Testes, QA e CI: `84 -> 90`
- Módulos premium de negócio: `74 -> 80`

---

## 5. Fase 2 — Observabilidade e Governança

**Prioridade:** `P0`  
**Meta:** elevar a maturidade operacional do produto

### 5.1 Objetivos

- enriquecer dashboard e indicadores;
- aprofundar a trilha de auditoria;
- fortalecer diagnósticos operacionais de runtime;
- melhorar visibilidade sobre incidentes e gargalos.

### 5.2 Escopo

1. expandir KPIs gerenciais em `dashboard`:
   - tempos médios possíveis com dados já disponíveis;
   - volume por período;
   - handoff rate quando a base permitir cálculo confiável;
2. revisar lacunas de auditoria:
   - ações administrativas críticas;
   - transições importantes de conversa e operação;
3. consolidar observabilidade mínima para:
   - worker
   - realtime
   - webhook
   - dead-letter
4. alinhar `/docs` de observabilidade e runtime ao estado final entregue.

### 5.3 Critério de Saída

- dashboard deixa de ser apenas operacional básico e ganha utilidade gerencial real;
- auditoria cobre ações mais críticas de operação;
- incidentes técnicos ficam mais fáceis de investigar.

### 5.4 Nota Esperada Após a Fase

- Dashboard, auditoria e observabilidade: `76 -> 86`
- **Fase 2 encerrada em 2026-04-10** — logs estruturados Worker/Realtime (Plan 66), dead-letter stats (Plan 68), webhook security stats, test:postgres-real ampliado, docs/12 consolidado

---

## 6. Fase 3 — Premium de Produto

**Prioridade:** `P1`  
**Meta:** transformar capacidade funcional em experiência premium consolidada

### 6.1 Objetivos

- fechar fluxos ponta a ponta dos módulos premium;
- elevar consistência entre backend, frontend e operação;
- tirar frentes como labels/sectors/groups/transfers do estágio “funciona” para “produto maduro”.

### 6.2 Escopo

1. labels:
   - CRUD completo validado;
   - vínculo com conversa/contato refinado na UI;
   - filtros úteis e consistentes;
2. sectors:
   - gestão e visão operacional mais completas;
   - vínculos com usuários e conversas mais claros;
3. contact groups:
   - CRUD + membership + experiência de uso mais fluida;
4. transfers:
   - fluxo operacional ponta a ponta mais forte;
   - estados, feedback e rastreabilidade;
5. settings/admin:
   - consolidar páginas que hoje existem com maturidade desigual.

### 6.3 Critério de Saída

- módulos premium principais deixam de parecer extensões laterais e passam a integrar o fluxo central do produto;
- UX e comportamento ficam coerentes com ferramenta enterprise.

### 6.4 Nota Esperada Após a Fase

- Módulos premium de negócio: `74 -> 86`
- Admin e operação de suporte: `82 -> 88`
- Frontend desk-web: `85 -> 89`

---

## 7. Fase 4 — Runtime, Deploy e Operação

**Prioridade:** `P1`  
**Meta:** aproximar o projeto de produção enterprise real

### 7.1 Objetivos

- fortalecer runbooks;
- reduzir dependência de setup manual;
- deixar operação e troubleshooting mais previsíveis;
- melhorar o contrato entre ambiente local, CI e produção.

### 7.2 Escopo

1. revisar scripts e setups que ainda dependem de conhecimento tácito;
2. consolidar runbook de produção:
   - bootstrap
   - health/readiness
   - webhook
   - realtime
   - worker
   - smoke pós-deploy
3. revisar gaps de persistência operacional:
   - especialmente dead-letter, se já justificar evolução além de memória;
4. alinhar `docs/18`, `docs/21` e documentação operacional adjacente.

### 7.3 Critério de Saída

- setup de operação mais previsível para time e CI;
- menos risco de erro humano em deploy e troubleshooting;
- maior prontidão real de ambiente enterprise.

### 7.4 Nota Esperada Após a Fase

- Runtime, deploy e prontidão operacional: `78 -> 88`

---

## 8. Fase 5 — Consolidação Final Enterprise Premium

**Prioridade:** `P2`  
**Meta:** fechar a narrativa final do produto e limpar o restante residual

### 8.1 Objetivos

- reauditar o projeto inteiro;
- fechar gaps residuais pequenos;
- atualizar a documentação-mãe;
- produzir baseline final de maturidade.

### 8.2 Escopo

1. reauditar `/docs` vs código;
2. revisar `docs/GAPS-TECNICOS.md`;
3. revisar score consolidado;
4. publicar relatório final de baseline enterprise premium;
5. decidir explicitamente o que permanece como backlog futuro, sem fingir conclusão total.

### 8.3 Critério de Saída

- documentação executiva e técnica alinhadas;
- backlog residual pequeno e honesto;
- projeto com baseline final clara para operação enterprise.

---

## 9. Priorização Consolidada

| Ordem | Fase | Prioridade | Por quê |
|------|------|------------|--------|
| `1` | Robustez e Cobertura | `P0` | sem isso, o restante cresce em risco |
| `2` | Observabilidade e Governança | `P0` | produto enterprise precisa ser visível e auditável |
| `3` | Premium de Produto | `P1` | aumenta valor percebido e maturidade funcional |
| `4` | Runtime, Deploy e Operação | `P1` | fecha a prontidão real para operação forte |
| `5` | Consolidação Final | `P2` | fecha baseline e limpa resíduo |

---

## 10. Sequência Recomendada de Execução Prática

### Trilha recomendada em entregas menores

1. pacote de testes dos módulos premium;
2. pacote de observabilidade/KPIs;
3. pacote de refinamento de labels/sectors/groups/transfers;
4. pacote de runtime/deploy/runbook;
5. auditoria final e rebaseline.

### Regra de ouro

Se houver dúvida entre “nova feature premium” e “mais robustez/observabilidade”, priorizar:

1. robustez;
2. observabilidade;
3. produto premium;
4. cosmética.

---

## 11. Resultado Esperado

Se as fases acima forem executadas com consistência, o projeto deve chegar a algo próximo de:

| Frente | Nota alvo |
|------|------:|
| Fundação | `92+` |
| Segurança | `90+` |
| Chat/Webhook | `90+` |
| Operação interna | `86+` |
| Eventos/Worker | `94+` |
| Realtime | `89+` |
| Secretary/Handoff | `88+` |
| Admin | `88+` |
| Frontend | `89+` |
| Observabilidade | `86+` |
| Testes/CI | `90+` |
| Runtime/Deploy | `88+` |
| Módulos premium | `86+` |

### Nota global alvo

**`92+/100`**

---

## 12. Conclusão

O restante do trabalho não é mais “construir o produto”. O restante é:

- aprofundar qualidade;
- consolidar governança;
- amadurecer experiência premium;
- fechar prontidão operacional real.

Esse é o caminho mais seguro para o CVG Connect Desk chegar a um estado que faça jus ao nome **Enterprise Premium**.

