# PROD-06 — Harmonizar schema e timezone; preparar evolução relacional

**Observação da auditoria:** 12/12 testes R3 passam em segmento próprio r3-prod06-20260914-a5; D03 permanece OPEN, N:N não foi implementado e Docker/revisão independente continuam pendentes.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** Sem achado individual; completar/revalidar os aceites.

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-06 / estado recebido PLANNED

**Estado:** REVIEW · **Prioridade:** P1 · **Marco:** M1 · **Estimativa relativa:** 3

**Dono funcional:** Backend dados · **Risco:** R3 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** DT01, BE03, BE08, BE10, BE20

**Dependências:** [PROD-01](PROD-01.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `packages/database/src/schema.ts`
- `packages/database/src/check-migrations.ts`
- `packages/database/supabase/migrations`
- `modules/tutors/src`
- `modules/patients/src`
- `apps/desk-api/src/__tests__/production/prod-06.test.ts`

**Locks:** schema-migrations

## Critérios de aceite

- **PROD-06-AC1** — Confrontar schema completo com ledger/DDL e corrigir timestamp vs timestamptz de sessão; testar valores históricos em UTC e America/Sao_Paulo preservando instantes e deadlines.
- **PROD-06-AC2** — FKs/índices/uniques e deletes têm invariantes verificáveis; upgrade de cópia populada e migration fresh independentes, drift/checksum divergente bloqueia readiness.
- **PROD-06-AC3** — Inventariar tutor_patients N:N documentado versus patient.tutorId e preparar proposta D03 com impacto, migração e compatibilidade. Este aceite termina na proposta; decisão e implementação relacional pertencem a PROD-25 e não bloqueiam as correções independentes de sessão/webhook.
- **PROD-06-AC4** — Numerar novas migrations pelo integrador; ensaiar interrupção/restart e roll-forward, sem editar SQL já aplicado nem deletar dados para testes.

## Verificação proposta

Estado: **PASS**. Ambiente: Candidato R3 com PostgreSQL/Redis locais isolados; D03 materializada a partir da documentação R3; migrations 0000..0022 conferidas contra o ledger do PROD-00; Docker continua indisponível..

12/12 testes passam, cobrindo AC1–AC4, sem skip; proposta D03 permanece OPEN e N:N não é implementado.

```bash
CVG_PROGRAM_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3 CVG_RUNTIME_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3/evidencias/prod-06/r3-prod06-20260914-a5/runtime CVG_EVIDENCE_SEGMENT=r3-prod06-20260914-a5 CVG_PROD00_EVIDENCE_SEGMENT=r3-prod00-20260914-a2 AAA_RUN_ID=r3-prod06-20260914-a5 AAA_WORKER_INDEX=8 AAA_ATTEMPT=5 pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-06.test.ts
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

12/12 testes R3 passam em PostgreSQL/Redis isolados, cobrindo schema/timezone, fresh/upgrade, drift/checksum, D03 OPEN e interrupção/roll-forward; revisão do integrador ainda é necessária.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-06/r3-prod06-20260914-a5/manifest.json, evidencias/prod-06/r3-prod06-20260914-a5/D03-PROPOSTA.md, evidencias/prod-06/r3-prod06-20260914-a5/schema-confronto.json, evidencias/prod-06/r3-prod06-20260914-a5/runtime/environment/isolated-env.json, evidencias/prod-06/r3-prod06-20260914-a5/logs/db-migrate-cli.log, evidencias/prod-06/r3-prod06-20260914-a5/logs/db-check-cli.log, evidencias/prod-06/r3-prod06-20260914-a5/logs/tz-child-america-sao-paulo.log, evidencias/prod-06/r3-prod06-20260914-a5/logs/interrupt-roll-forward.log, evidencias/prod-06/r3-prod06-20260914-a5/prod-06.test.log

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
