# Backlog de Elevação para 96/100

**Data:** 2026-04-27  
**Documento pai:** `docs/72-roadmap-98-porcento.md`  
**Objetivo:** Trazer score operacional para **96/100** com evidência técnica verificável.

> Este backlog e historico. O fechamento operacional mais recente esta em `docs/80-fechamento-execucao-p0-p1-p2.md`; a evidencia final PASS esta em `qa-runs/20260427-202434/summary.json`.

---

## Convenções

| Nível | Significado |
|---|---|
| 🔴 P1 | Crítico — bloqueia o alcance da meta |
| 🟡 P2 | Importante — melhora diretamente nota e confiança |
| 🟢 P3 | Nice-to-have — acabamento |

---

## P1 — Falha explícita no ciclo (`qa:full-cycle`)

**Status:** ✅ **IMPLEMENTADO**  
**Score atual esperado:** +6

### Entrega
- `scripts/run-full-cycle.sh` faz pré-check de ambiente antes de subir `desk-api`:
  - `docker`
  - `docker compose`
  - `pnpm`
  - `curl`
- O ciclo falha cedo com mensagem amigável caso ambiente esteja incorreto.

### Critérios de aceite
- Execução com `docker` ausente retorna erro claro e não continua.
- `COMPOSE_FILE` ausente retorna erro claro e não continua.

### Comandos
- `pnpm run qa:full-cycle`

### Risco
- Baixo.

---

## P2 — `summary.json` com validação obrigatória

**Status:** ✅ **IMPLEMENTADO**  
**Score atual esperado:** +4

### Entrega
- O script valida leitura de `stress-test/summary.json`.
- Valida se `scenario_thresholds.scenario_passed` existe e está disponível.
- Falha com saída não-zero quando o cenário não passa.

### Critérios de aceite
- `summary.json` incompleto ou vazio causa falha do ciclo.
- `scenario_thresholds.scenario_passed = false` faz `qa:full-cycle` terminar com status `!= 0`.

### Comandos
- `pnpm run qa:full-cycle`
- `jq '.scenario_thresholds.scenario_passed' stress-test/summary.json`

---

## P3 — Corrigir redundância de saída de thresholds

**Status:** ✅ **IMPLEMENTADO**  
**Score atual esperado:** +1

### Entrega
- Remoção de chave duplicada (`checks_rate`) em `stress-test/k6-stress-test.js`.

### Critérios de aceite
- `scenario_thresholds` contém somente uma chave `checks_rate` com `threshold`, `actual` e `passed`.
- `stress-test/summary.json` não apresenta perda de informação por sobrescrita.

---

## P4 — Padronizar checklist de thresholds no ciclo

**Status:** ✅ **IMPLEMENTADO**  
**Score atual esperado:** +2

### Entrega
- Consolidar no `README` a regra de decisão: qualquer métrica fail -> ciclo interrompido e reexecução necessária.
- Exibir no resumo:
  - `duration_p95_ms`
  - `error_rate_5xx_percent`
  - `checks_rate`
  - `scenario_passed`

### Critérios de aceite
- Documento de operação com critérios objetivos de PASS/FAIL.
- Usuário consegue repetir o ciclo sem ambiguidades.

### Comandos
- `pnpm run qa:full-cycle`
- `sed -n "1,220p" README.md`

---

## P5 — Evidência para revisão seguinte

**Status:** ✅ **IMPLEMENTADO E EXECUTADO**  
**Score atual esperado:** +3

### Entrega
- Novo comando de evidência: `pnpm run qa:full-cycle:archive`.
- Execução armazena:
  - Log completo em `qa-runs/<timestamp>/qa-full-cycle.log`
  - `summary.json` em `qa-runs/<timestamp>/summary.json`
- Registra automaticamente uma linha em `docs/qa-full-cycle-log.md`.

### Critérios de aceite
- Reexecução local gera arquivos com data/hora no diretório de evidências.
- O changelog de QA (`docs/qa-full-cycle-log.md`) recebe novo registro.
- A validação de sucesso final depende do run real retornar `scenario_thresholds.scenario_passed = true`.

### Comandos
- `pnpm run qa:full-cycle:archive`
- `cat docs/qa-full-cycle-log.md`
- `cat qa-runs/<timestamp>/qa-full-cycle.log`

---

## P6 — Ajuste final de documentação de decisão

**Status:** ✅ **IMPLEMENTADO**  
**Score atual esperado:** +1

### Entrega
- Texto final consolidado em `docs/72-roadmap-98-porcento.md` e `docs/75-roadmap-98-porcento.md` com regras de decisão e estado da trilha.

### Critérios de aceite
- Documentação de operação com critérios objetivos de passagem/reprovação do ciclo.
- Rastreabilidade de P1..P6 em ambas as páginas de plano/backlog.

### Comandos
- `pnpm run qa:full-cycle`
- `pnpm run qa:full-cycle:archive`
- `sed -n "1,220p" README.md`

## Visão de Prioridade

- 🔴 P1: Obrigatório
- 🟡 P2: Obrigatório
- 🟢 P3: Concluído
- 🟢 P4: Concluído
- 🟢 P5: Implementado (aguarda execução real para fechamento final)

P1-P6 foram implantados e a rerun final foi executada com `scenario_passed=true`. O score operacional consolidado volta a **96/100** conforme `docs/80-fechamento-execucao-p0-p1-p2.md`.
