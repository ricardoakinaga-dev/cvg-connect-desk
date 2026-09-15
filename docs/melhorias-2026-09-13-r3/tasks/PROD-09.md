# PROD-09 — Garantir efeitos idempotentes de worker e falhas observáveis

**Observação da auditoria:** 13/13 testes R3 passam em segmento próprio r3-prod09-20260914-a2; nenhuma prova de produção ou revisão independente foi alegada.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** Sem achado individual; completar/revalidar os aceites.

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-09 / estado recebido PLANNED

**Estado:** REVIEW · **Prioridade:** P0 · **Marco:** M1 · **Estimativa relativa:** 5

**Dono funcional:** Backend worker/eventos · **Risco:** R3 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE11, BE12, BE07, UI08

**Dependências:** [PROD-08](PROD-08.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `apps/message-worker/src`
- `modules/alerts/src`
- `modules/transfers/src`
- `packages/events/src`
- `packages/database/supabase/migrations`
- `apps/desk-api/src/__tests__/production/prod-09.test.ts`

**Locks:** schema-migrations, worker-runtime

## Critérios de aceite

- **PROD-09-AC1** — Err de createAlert e outros handlers propaga falha e impede ACK de sucesso; resultados de ACK/NACK stale são observados e não relatados como concluídos.
- **PROD-09-AC2** — Efeito+registro de dedup durável por evento/consumidor/ação são transacionais; crash após efeito antes ACK, lease expirado e redelivery não duplicam alerta/handoff.
- **PROD-09-AC3** — Falha transitória respeita retry budget/backoff; poison/malformed/unsupported version termina em DLQ com sourceEvent íntegro e motivo; tipo ignorável precisa contrato explícito.
- **PROD-09-AC4** — Testes PG e processos reais cobrem parada/restart/retry/DLQ e recuperação de outro consumidor sem perda; auditoria e métricas do efeito e decisão são minimizadas.

## Verificação proposta

Estado: **PASS**. Ambiente: Candidato R3 com PostgreSQL/Redis locais isolados e processos reais de worker/lease; efeitos idempotentes, retry/DLQ, fencing e crash cobertos; nenhum dado de produção..

13/13 testes locais passam sem skip; revisão independente e integrações externas continuam fora da prova.

```bash
CVG_PROGRAM_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3 CVG_RUNTIME_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3/evidencias/prod-09/r3-prod09-20260914-a2/runtime CVG_EVIDENCE_SEGMENT=r3-prod09-20260914-a2 AAA_RUN_ID=r3-prod09-20260914-a2 AAA_WORKER_INDEX=22 AAA_ATTEMPT=2 pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-09.test.ts
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

13/13 testes R3 passam com PostgreSQL/Redis e processos reais, cobrindo efeitos idempotentes, retry/DLQ, fencing de lease e crash após efeito; revisão independente ainda é necessária.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-09/r3-prod09-20260914-a2/manifest.json, evidencias/prod-09/r3-prod09-20260914-a2/prod-09-evidence.json, evidencias/prod-09/r3-prod09-20260914-a2/runtime/environment/isolated-env.json, evidencias/prod-09/r3-prod09-20260914-a2/prod-09.test.log

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
