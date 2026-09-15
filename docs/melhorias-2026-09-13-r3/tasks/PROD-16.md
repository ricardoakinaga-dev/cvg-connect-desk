# PROD-16 — Fechar escopo de privacidade e política por cópia

**Observação da auditoria:** Suíte R3 de PROD-16 executada em segmento próprio r3-prod16-20260914-a1; 9/9 passou com PostgreSQL isolado e HTTP real. D02 permanece OPEN em dry-run e BE-A05/bypass legado, revisão independente e gates externos permanecem pendentes.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** BE-A05

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-16 / estado recebido PLANNED

**Estado:** REVIEW · **Prioridade:** P0 · **Marco:** M1 · **Estimativa relativa:** 8

**Dono funcional:** Backend privacidade + responsável dados · **Risco:** R3 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE20, BE05, BE19, OP08

**Dependências:** [PROD-01](PROD-01.md), [PROD-06](PROD-06.md)

**Decisões:** D02

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `modules/privacy/src`
- `modules/notes/src`
- `modules/alerts/src`
- `packages/database/supabase/migrations`
- `docs/LGPD_DATA_SUBJECT_REQUESTS.md`
- `apps/desk-api/src/__tests__/production/prod-16.test.ts`

**Locks:** schema-migrations, auth-contract

## Critérios de aceite

- **PROD-16-AC1** — GET/resume/export/erase sempre revalidam principal, permissão e escopo atual; requestId idempotente vinculado ator+contato+payload, reuso incompatível409 sem relatório alheio.
- **PROD-16-AC2** — Criação/retomada com checkpoint sob duas identidades, revogação no meio e crash não atravessa setor nem declara conclusão quando parcial; autor vem da sessão, incluindo alertas/notas.
- **PROD-16-AC3** — D02 ratifica retenção/finalidade/ação por contato,mensagem,nota,outbox,DLQ,asset,audit,logs,backup e relações tutor-paciente; inventário/dry-run podem avançar, mutação irreversível dependente só após decisão real.
- **PROD-16-AC4** — Exportação/residual scan e reaplicação de erasures após restore provam alcance; auditoria registra ator/correlação sem payload sensível integral e guarda recusas.
- **PROD-16-R2-AC5** — Eliminar bypass da rota legada /privacy/contacts/:id/anonymize: mesma política, escopo atual, recibo/checkpoint e confirmação da erasure, ou bloqueio seguro. Com D02 OPEN/default dry-run não ocorre mutação irreversível; ator de A não altera cópias em B. Falha entre contato/mensagens/audit seguida de retry converge. Testar HTTP+PG próprio.
- **PROD-16-R2-AUTH** — Usar o contrato C02 existente e coordenar alterações compartilhadas com PROD-04 via lock auth-contract. Correção do bypass legado avança após PROD-01/06, sem aguardar aceite global de autorização; G02 só fecha após provas de PROD-04 e PROD-16.

## Verificação proposta

Estado: **PASS**. Ambiente: Candidato R3 com PostgreSQL isolado e HTTP real via app.inject do app de produção; D02 permanece OPEN, defaults dry-run e mutações irreversíveis não são executadas; Secretary/provider externo mockado por contrato, sem dados de produção..

9 testes passam sem skip; política por cópia, requestId/escopo, revogação, checkpoints, exportação, residual scan, dry-run, auditoria e negativos permanecem observáveis; bypass legado, D02, revisão independente e gates externos continuam pendentes.

```bash
CVG_PROGRAM_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3 CVG_RUNTIME_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3/evidencias/prod-16/r3-prod16-20260914-a1/runtime CVG_EVIDENCE_SEGMENT=r3-prod16-20260914-a1 AAA_RUN_ID=r3-prod16-20260914-a1 AAA_WORKER_INDEX=25 AAA_ATTEMPT=1 pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-16.test.ts
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Suíte R3 executada em PG isolado e HTTP real; 9/9 testes passaram cobrindo política por cópia, escopo/revogação, checkpoints, exportação, residual scan, dry-run e auditoria. D02 e BE-A05 (bypass legado) permanecem pendentes; nenhuma eliminação irreversível foi executada.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-16/r3-prod16-20260914-a1/manifest.json, evidencias/prod-16/r3-prod16-20260914-a1/prod-16.test.log, evidencias/prod-16/r3-prod16-20260914-a1/prod-16-evidence.json, evidencias/prod-16/r3-prod16-20260914-a1/runtime/environment/isolated-env.json

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
