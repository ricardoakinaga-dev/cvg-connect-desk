# Plano Executivo: Elevação de 89 → 96/100

**Data:** 2026-04-27  
**Objetivo:** Elevar o score de medição operacional de **89/100** para **96/100**  
**Status atual:** ✅ **HISTORICO - FECHADO COM EVIDENCIA**

> Este documento e historico. O fechamento mais recente esta em `docs/80-fechamento-execucao-p0-p1-p2.md`; a execucao final PASS esta em `qa-runs/20260427-202434/summary.json`.

---

## 1) Diagnóstico atual (resumo)

| Frente | Nota atual | Nota alvo | Diferença | Motivo de ajuste |
|---|---:|---:|---:|---|
| Estabilidade do ciclo único de QA | 90 | 96 | +6 | Falha silenciosa quando thresholds de stress não passam. |
| Rastreabilidade de execução | 84 | 92 | +8 | Falta validação de pré-requisitos e de schema mínimo de `summary.json`. |
| Clareza e repetibilidade de thresholds | 83 | 95 | +12 | O ciclo precisa falhar explicitamente e imprimir status PASS/FAIL por métrica. |
| Qualidade documental (docs de operação) | 88 | 96 | +8 | Consolidação em linguagem de execução e critérios objetivos. |

**Meta mínima para 96/100:** `score médio >= 96` com evidência mensurável de execução.

---

## 2) Roadmap de execução (P1+)

## Sprint 1 (S63) — Confiabilidade do ciclo

### P1 — Pré-check de execução antes de subir API
**Descrição:** Validar dependências críticas (`docker`, `docker compose`, `pnpm`, `curl`) e arquivo de compose antes de iniciar o ciclo.  
**Critério de aceite:** ciclo falha rápido com erro legível quando o ambiente estiver incorreto.  
**Responsável:** CI/DevOps  
**Estimativa:** 2h  
**Status:** ✅ Implementado

### P2 — Falha explícita em thresholds do stress
**Descrição:** O `qa:full-cycle` deve ler `stress-test/summary.json` e interromper com erro se `scenario_thresholds.scenario_passed` for `false`.  
**Critério de aceite:** comando retorna não-zero quando qualquer threshold falhar.  
**Estimativa:** 2h  
**Status:** ✅ Implementado

### P3 — Validação estrutural mínima do `summary.json`
**Descrição:** Validar que `scenario_thresholds` e `summary` existem no output antes de reportar.  
**Critério de aceite:** `print_summary` falha em schema inválido e não gera falso positivo.  
**Estimativa:** 1h  
**Status:** ✅ Implementado

---

## Sprint 2 (S64) — Padronização de medição

### P4 — Remoção de inconsistência no output de thresholds
**Descrição:** remover chave duplicada em `checks_rate` no output de `scenario_thresholds` (`stress-test/k6-stress-test.js`).  
**Critério de aceite:** objeto de thresholds contém apenas uma chave de `checks_rate` com tipos consistentes (`threshold`, `actual`, `passed`).  
**Estimativa:** 30m  
**Status:** ✅ Implementado

### P5 — Reroda inicial e trilha de evidência
**Descrição:** executar `pnpm run qa:full-cycle` após alterações e registrar resultado esperado (health ok, tasks ok, stress thresholds pass/fail explícito).  
**Critério de aceite:** `stress-test/summary.json` com `scenario_thresholds.scenario_passed` e campos mínimos para auditoria.  
**Estimativa:** 30m  
**Status:** ✅ Pronto para execução (com script `qa:full-cycle:archive`)

### P6 — Ajuste final de documentação de operação
**Descrição:** Atualizar `README` e `docs/*` com a versão 96/100 e checklist de decisão por item (PASS/FAIL).  
**Critério de aceite:** seção de "Comando rápido" e "Ciclo de validação completo" com critérios objetivos.  
**Estimativa:** 1h  
**Status:** ✅ Implementado

---

## 3) Métricas de sucesso para 96/100

- [x] `pnpm run qa:full-cycle` falha com erro claro em ambiente inválido.
- [x] `stress-test/summary.json` validado por schema mínimo (`scenario_thresholds` + `summary`).
- [x] `scenario_thresholds.scenario_passed = true` ou falha explícita com status final não-zero.
- [x] Cada threshold (`duration_p95_ms`, `error_rate_5xx_percent`, `checks_rate`) com campo `passed` e valor atual.
- [x] Checklist de decisão PASS/FAIL registrado no `README.md` e refletindo fluxo real (setup → health → tests → stress → resumo).
- [x] Executar `pnpm run qa:full-cycle:archive` e registrar resultado em `docs/qa-full-cycle-log.md` com:
  - `scenario_passed`
  - status de comando
  - log completo.
- [x] Auditoria seguinte de execução: **96/100**.

## 4) Atualização de score prevista (pós-implementação)

- P1 (Pré-check): +6
- P2 (Fail-fast): +4
- P3 (Schema validation): +2
- P4 (Output cleanup): +1
- P6 (Docs): +4

**Total estimado ganho:** +17 -> score projetado **106/100** (capado em 100), porém limitado por itens fora do escopo atual; meta acordada mantida em **96/100**.

## 5) Evidências esperadas por item

- `scripts/run-full-cycle.sh` com validações e retorno não-zero em falha.
- `stress-test/k6-stress-test.js` sem duplicidade de `checks_rate`.
- `README.md` com checklist de decisão operacional PASS/FAIL.
