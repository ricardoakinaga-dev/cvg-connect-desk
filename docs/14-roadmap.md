# Roadmap — CVG Connect Desk

## 1. Objetivo
Definir o plano de execução do **CVG Connect Desk** de forma:
- incremental;
- segura;
- coerente com a arquitetura definida;
- alinhada com o estado real do repositório.

Este documento estabelece:
- fases de construção;
- ordem obrigatória de execução;
- dependências reais;
- critérios de entrada e saída por fase;
- regras para evitar implementação fora de ordem.

## 2. Estado Atual do Projeto

> **Nota de leitura:** Revisado em 2026-04-24. O projeto está em **fase de maturação enterprise**.

No momento atual:
- a documentação arquitetural está avançada e endurecida;
- o monorepo está estruturado com `apps`, `modules` e `packages`;
- todas as fases de 0 a 8 estão **concluídas**;
- existe pipeline assíncrono com worker implementado (apps/message-worker);
- existe realtime-service implementado (apps/realtime-service) **e conectado ao frontend**;
- existe frontend operacional (apps/desk-web) com Inbox 3 colunas, Tasks, Alerts, Dashboard;
- IAM, Chat Core, Operations já possuem modelagem concreta no banco;
- existe integração com Secretary via modules/secretary-adapter;
- autenticação real implementada com login, logout, sessões e RBAC;
- rate limiting implementado via @fastify/rate-limit;
- **NEW:** Planos para elevação para 95/100 definidos em `docs/72-roadmap-95-porcento.md`

### Estado Consolidado: 84/100

| Frente | Nota |
|--------|------:|
| Fundações | 90 |
| Core | 84 |
| Infraestrutura | 87 |
| Interface | 81 |
| Qualidade | 83 |
| Deploy | 78 |
| **TOTAL** | **84** |

**Meta:** 95/100 — ver `docs/72-roadmap-95-porcento.md`

### Pendências Técnicas Conhecidas

| Gap | Descrição | Impacto | Prioridade |
|-----|-----------|---------|------------|
| Dashboard KPIs incompletos | Tempo médio resposta, handoff rate não têm fonte de dados | Analytics incompleto | P1 |
| Runtime produção | Setup local OK, prod com arestas | Prontidão parcial | P2 |
| Cobertura testes | Avançada mas não enterprise total | Risco regressão | P2 |
| Validation checklist | 8/15 itens pendentes | Validação incompleta | P1 |

---

## 3. Princípios do Roadmap

### 3.1 Ordem É Obrigatória
As fases devem ser executadas na ordem definida.

Quebrar a ordem aumenta risco de retrabalho, acoplamento errado e refactor destrutivo.

### 3.2 Não Pular Fundação
Não implementar:
- UI completa;
- realtime avançado;
- analytics;

antes da base estar sólida.

### 3.3 Persistência Antes de Automação
Primeiro:
- persistir corretamente.

Depois:
- automatizar;
- reagir;
- otimizar.

### 3.4 API Antes de Worker
- estado nasce na API;
- worker reage;
- realtime projeta.

### 3.5 Evitar Over-Engineering Precoce
- sem microserviço desnecessário;
- sem pipeline complexo antes da necessidade;
- sem otimização prematura.

---

## 4. Visão Geral das Fases

```text
Phase 0 -> Foundation                  [CONCLUÍDA]
Phase 1 -> Core Chat                   [CONCLUÍDA]
Phase 2 -> Operations (Tasks/Notes)     [CONCLUÍDA]
Phase 3 -> Integrations + Secretary     [CONCLUÍDA]
Phase 4 -> Realtime                    [CONCLUÍDA]
Phase 5 -> Dashboard + Observability  [CONCLUÍDA]
Phase 6 -> Frontend MVP               [CONCLUÍDA]
Phase 7 -> Hardening + Production      [CONCLUÍDA]
Phase 8 -> Refinement & Deployment     [CONCLUÍDA]
Phase 9 -> Enterprise 95/100          [PLANEJADA] ← NOVO
```

---

## 5. Phase 9 — Enterprise 95/100

### Objetivo
Elevar o projeto de 84/100 para 95/100, fechando lacunas de:
- Dashboard KPIs completos
- Runtime production hardened
- Cobertura de testes enterprise
- Observabilidade avançada
- Validation checklist completa

### Inclui
- Implementação de KPIs faltantes (tempo médio resposta, handoff rate)
- Health check ramificado com sub-checks
- Readiness probing completo
- Cobertura de testes 80%+ em modules core
- Métricas Prometheus
- OpenTelemetry tracing
- Stress test e load testing

### Não Inclui
- Reescrita de arquitetura
- Novos domínios de negócio
- Migração para outro stack

### Dependências
- Phases 0-8 concluídas.

### Critério de Entrada
- CI verde
- Todas as fases anteriores estáveis
- Gap analysis validado

### Critério de Saída
- Scorecard 95/100 em todas as frentes
- 15/15 validation checklist itens passando
- Coverage ≥80% em modules core
- Stress test passando

---

## 6. Phase 8 — Refinement & Deployment

> Status: **CONCLUÍDA**

### Objetivo
Refinar detalhes finais e preparar deployment.

### Critério de Saída
- Sistema estável;
- documentado;
- pronto para operação.

---

## 7. Dependências Críticas

### 7.1 Ordem Obrigatória
- data model -> backend -> events -> realtime -> dashboard.

### 7.2 Relações-Chave
- `messages` depende de `conversations`;
- tasks dependem de `conversation`, `tutor` ou `patient`;
- alerts dependem de eventos e estado operacional já persistido;
- dashboard depende de dados persistidos, definições de KPI e observabilidade mínima;
- worker depende de API e persistência prévias;
- realtime depende de eventos e contratos internos consistentes;
- frontend operacional depende de backend e contratos estáveis.

---

## 8. Critérios de Qualidade por Fase

Cada fase deve:
- não quebrar a anterior;
- ser testável isoladamente;
- ter comportamento observável;
- ter logs mínimos;
- ter fallback seguro;
- preservar coerência com os documentos já endurecidos.

---

## 9. Regra de Execução

Antes de iniciar qualquer fase, é obrigatório:
- verificar dependências;
- validar documentos anteriores;
- confirmar ausência de conflito estrutural;
- evitar implementar fora da fase atual.

---

## 10. Referências

- **Plano para 95/100:** `docs/72-roadmap-95-porcento.md`
- **Backlog detalhado:** `docs/73-backlog-95-porcento.md`
- **Relatório de gap:** `docs/71-relatorio-documentacao-vs-implementacao.md`
- **Validation checklist:** `docs/16-validation-checklist.md`
- **Dashboard KPIs:** `docs/13-dashboard-and-kpis.md`

---

**Última atualização:** 2026-04-24
