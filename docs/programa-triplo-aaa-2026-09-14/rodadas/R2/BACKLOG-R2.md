# Backlog priorizado da rodada R2 — histórico

**Supersedido em 15/09/2026 pelo [backlog R3](../R3/BACKLOG-R3.md). Estados abaixo representam a entrada histórica da R2.**

Esta é uma fila executiva. Estados, dependências, aceites e evidências pertencem ao [BACKLOG.json](../../BACKLOG.json) e aos cartões em `../../tasks/`.

## P0 — corrigir antes de expandir

| Ordem | Tarefa | Resultado exigido |
|---:|---|---|
| 1 | [SA-007](../../tasks/SA-007.md) | Typecheck e integração isolada verdes; nova crítica; retorno a `DONE`. |
| 2 | [SA-008](../../tasks/SA-008.md) | Browser+API real prova contexto, navegação e negativos; retorno a `DONE`. |
| 3 | [SA-012](../../tasks/SA-012.md) | Lifecycle HTTP/WS completo, incluindo revogação e expiração. |
| 4 | [SA-020](../../tasks/SA-020.md) | Inventário e decisão executável sobre tutor–paciente, sem presumir D03. |

Antes de promover a próxima onda, acrescentar a prova negativa de log/erro de SA-004 e selar a identidade completa do checkpoint. Esses fechamentos não alteram a pontuação da tarefa sem nova evidência.

## P1 — domínio e dados

Executar conforme dependências:

`SA-011, SA-013, SA-014, SA-015, SA-016, SA-017, SA-018, SA-019, SA-021, SA-022, SA-023, SA-024, SA-025, SA-026, SA-027, SA-028, SA-029, SA-030, SA-031, SA-032`.

SA-017 exige worker real e crítica nova. SA-022 exige handoff, reabertura, tarefa, alerta, D01 e `EXPLAIN`. Provas de mock não fecham integração com provedores, storage ou scanner.

## P1 — experiência e fundamentos operacionais

`SA-033, SA-034, SA-035, SA-036, SA-037, SA-038, SA-039, SA-040, SA-041, SA-042, SA-043, SA-044, SA-045, SA-046, SA-047, SA-048, SA-049, SA-052, SA-053, SA-063`.

Prioridades da auditoria:

- Eliminar a falha de tipos e os 142 avisos sem afrouxar regras.
- Reduzir JS inicial abaixo de 120 KiB gzip.
- Completar a matriz 16×5, estados críticos, zoom, teclado, leitor de tela e dispositivo real.
- Preservar no primeiro viewport móvel a tarefa prioritária e o alerta crítico acionável.

## P1 — prova, qualificação e operação

`SA-050, SA-051, SA-054, SA-055, SA-056, SA-057, SA-058, SA-059, SA-060, SA-061, SA-062`.

SA-059 só inicia com todas as entregas anteriores `DONE` e um candidato imutável. SA-061 requer autoridade de implantação; SA-062 requer tempo real de operação.

## Resumo quantitativo

| Estado de entrada | Tarefas | Pontos restantes |
|---|---:|---:|
| REWORK | 4 | 23 |
| PLANNED | 51 | 350 |
| Total não DONE | 55 | 373 |
