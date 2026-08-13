# QA Full-cycle Log

Arquivo de evidência de execuções do comando de validação `pnpm run qa:full-cycle`.

| Data/Hora | Status | scenario_passed | Log | Summary |
|---|---|---|---|---|
| 2026-04-27 00:00:00 | ⏳ PENDENTE | N/A | `qa:full-cycle` não executado nesta trilha | `--` |

## Como registrar novo run

Use o comando:

```bash
pnpm run qa:full-cycle:archive
```

Esse fluxo:

- sobe/reutiliza a API em `http://localhost:3000` via compose;
- roda `pnpm --filter @cvg/tasks test`;
- roda `pnpm test:stress`;
- salva log completo e `summary.json` em `qa-runs/<timestamp>/`;
- registra automaticamente esta tabela com `status`, `scenario_passed` e caminhos de artefatos.

| 2026-04-27 20260427-161158 | ❌ FAIL | false | `qa-runs/20260427-161158/qa-full-cycle.log` | `qa-runs/20260427-161158/summary.json` |

| 2026-04-27 20260427-161620 | ✅ PASS | true | `qa-runs/20260427-161620/qa-full-cycle.log` | `qa-runs/20260427-161620/summary.json` |

| 2026-04-27 20260427-165431 | ✅ PASS | true | `qa-runs/20260427-165431/qa-full-cycle.log` | `qa-runs/20260427-165431/summary.json` |

| 2026-04-27 20260427-200518 | ❌ FAIL | false | `qa-runs/20260427-200518/qa-full-cycle.log` | `qa-runs/20260427-200518/summary.json` |

| 2026-04-27 20260427-201016 | ✅ PASS | true | `qa-runs/20260427-201016/qa-full-cycle.log` | `qa-runs/20260427-201016/summary.json` |

| 2026-04-27 20260427-201952 | ❌ FAIL | false | `qa-runs/20260427-201952/qa-full-cycle.log` | `qa-runs/20260427-201952/summary.json` |

| 2026-04-27 20260427-202434 | ✅ PASS | true | `qa-runs/20260427-202434/qa-full-cycle.log` | `qa-runs/20260427-202434/summary.json` |

| 2026-04-27 20260427-204735 | ❌ FAIL | false | `qa-runs/20260427-204735/qa-full-cycle.log` | `qa-runs/20260427-204735/summary.json` |

| 2026-04-27 20260427-205236 | ✅ PASS | true | `qa-runs/20260427-205236/qa-full-cycle.log` | `qa-runs/20260427-205236/summary.json` |

| 2026-04-28 20260428-185520 | ❌ FAIL | false | `qa-runs/20260428-185520/qa-full-cycle.log` | `qa-runs/20260428-185520/summary.json` |

| 2026-04-28 20260428-190239 | ❌ FAIL | false | `qa-runs/20260428-190239/qa-full-cycle.log` | `qa-runs/20260428-190239/summary.json` |

| 2026-04-28 20260428-190821 | ❌ FAIL | false | `qa-runs/20260428-190821/qa-full-cycle.log` | `qa-runs/20260428-190821/summary.json` |

| 2026-04-28 20260428-191356 | ✅ PASS | true | `qa-runs/20260428-191356/qa-full-cycle.log` | `qa-runs/20260428-191356/summary.json` |
