# PROD-00 — Congelar candidato e ambiente de teste reproduzível

**Observação da auditoria:** 8/8 testes R3 passam em segmento próprio r3-prod00-20260914-a5, com baseline, canário de isolamento, disponibilidade, Playwright 6/6 positivo, canário negativo e teardown. Docker continua BLOCKED e a revisão independente permanece necessária.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** OPS07, DOC01

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-00 / estado recebido PLANNED

**Estado:** REVIEW · **Prioridade:** P1 · **Marco:** M0 · **Estimativa relativa:** 3

**Dono funcional:** Lead + plataforma · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** OP06, DT02, BE01

**Dependências:** Nenhuma; ponto de partida.

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `e2e/support/aaa`
- `e2e/support/production`
- `playwright.production.config.ts`
- `scripts/production`
- `docs/melhorias-2026-09-13-r3/evidencias`
- `scripts/production/prod-00.test.mjs`

**Locks:** Aplicar exclusão por arquivos e recursos do ambiente.

## Critérios de aceite

- **PROD-00-AC1** — Inventariar worktree sujo, HEAD, hashes de fontes/lock e imagens; reconciliar candidatos já presentes sem reset, limpeza ou substituição cega por HEAD.
- **PROD-00-AC2** — Reutilizar o harness AAA com runId, banco/Redis/bucket/portas próprios por worker, fixture marcada e teardown idempotente; recusar URL sem marcador e servidor alheio. Remover fuser/nomes fixos do caminho de teste utilizado.
- **PROD-00-AC3** — Criar configuração production que inclui novas suítes, valida identidade/isolamento e prova canário positivo/negativo do harness. Registrar disponibilidade de PostgreSQL/Redis/MinIO/ClamAV/OTel; serviço ausente bloqueia somente a prova dependente, nunca vira skip/PASS. Inventário e harness podem concluir sem todos os serviços disponíveis.
- **PROD-00-AC4** — Fixar Node/pnpm/lock atuais, seeds, relógio/timezone e concorrência; registrar baseline de checks disponíveis e perfil de carga especificado. Ausências recebem NOT_RUN/BLOCKED e dono na tarefa dependente; PROD-00 encerra inventário, identidade e isolamento sem alegar baseline funcional verde.

## Verificação proposta

Estado: **PASS**. Ambiente: Candidato R3; PostgreSQL/Redis isolados; Playwright com stack web/API/WS reais; canário negativo; runId r3-prod00-20260914-a5; worker 7.

8/8 testes passam; baseline, isolamento, disponibilidade, configuração Playwright, 6/6 HTTP positivo, canário negativo e teardown são cobertos.

```bash
CVG_PROGRAM_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3 CVG_RUNTIME_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3/evidencias/prod-00/r3-prod00-20260914-a5/runtime CVG_EVIDENCE_SEGMENT=r3-prod00-20260914-a5 AAA_RUN_ID=r3-prod00-20260914-a5 AAA_WORKER_INDEX=7 AAA_ATTEMPT=5 node --test scripts/production/prod-00.test.mjs
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

8/8 testes R3 passam em segmento próprio, com baseline, canário de isolamento, disponibilidade, Playwright 6/6 positivo, canário negativo e teardown. Docker continua BLOCKED e a revisão independente permanece necessária.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-00/r3-prod00-20260914-a5/manifest.json, evidencias/prod-00/r3-prod00-20260914-a5/baseline/candidate-manifest.json, evidencias/prod-00/r3-prod00-20260914-a5/environment/availability.json, evidencias/prod-00/r3-prod00-20260914-a5/isolation/canary.json, evidencias/prod-00/r3-prod00-20260914-a5/harness/production-report.json, evidencias/prod-00/r3-prod00-20260914-a5/harness/canary-report.json, evidencias/prod-00/r3-prod00-20260914-a5/checks/evidence-index.json, evidencias/prod-00/r3-prod00-20260914-a5/checks/prod-00.test.log

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
