# PROD-13 — Fechar budget durável e workflow seguro de ferramentas IA

**Observação da auditoria:** Suíte R3 de PROD-13 executada em segmento próprio r3-prod13-20260914-a1; budget durável/concorrente e workflow seguro de ferramentas estão cobertos; D05, provider externo e revisão independente permanecem pendentes.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** BE-A01, R3-BE01

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-13 / estado recebido PLANNED

**Estado:** REVIEW · **Prioridade:** P1 · **Marco:** M1 · **Estimativa relativa:** 5

**Dono funcional:** Backend IA + admin · **Risco:** R3 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE14, BE19, BE13

**Dependências:** [PROD-01](PROD-01.md), [PROD-10](PROD-10.md), [PROD-04](PROD-04.md)

**Decisões:** D05

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `modules/secretary-adapter/src`
- `packages/database/src/schema.ts`
- `packages/database/supabase/migrations`
- `modules/admin/src`
- `apps/desk-web/src/pages/Admin.tsx`
- `apps/desk-api/src/__tests__/production/prod-13.test.ts`

**Locks:** schema-migrations

## Critérios de aceite

- **PROD-13-AC1** — priorInvocations vem de contador persistente atômico por conversa; chamadas concorrentes e restart não superam orçamento. Conteúdo/histórico/timeout/retry já existentes permanecem.
- **PROD-13-AC2** — D05 define ferramentas efetivamente habilitadas. Conectar dispatcher existente ao enforcement se habilitadas, com validação ator/recurso, deny desconhecida e aprovação por revisor autorizado; caso não habilitadas, desabilitar exposição e corrigir claim sem anunciar fluxo ativo.
- **PROD-13-AC3** — Aprovação vinculada a payload original canônico/ação/recurso/escopo, nunca hash de versão truncada/sanitizada; CAS para decidir/consumir, expiração/revogação e uso único conforme contrato.
- **PROD-13-AC4** — Negativos budget, duplo approve/use, replay, args phone/email/conteúdo diferentes e ação proibida; registros sanitizados recursivamente e respostas tardias não vencem handoff humano.
- **PROD-13-R3-AC1** — Matar processo logo após begin, após resposta IA e antes da persistência/entrega; restart converge por resultado persistido ou reconciliação explicitamente pendente, nunca mero ACK de trabalho perdido; provar uma chamada externa.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: Candidato R3 com PostgreSQL isolado, sandbox HTTP local do Secretary, contador durável e enforcement de ferramentas; nenhum provider externo ou dado de produção..

Todos os testes locais passam sem skip; budget concorrente/restart, deny-default, aprovação CAS/hash original, expiração, sanitização e negativos permanecem observáveis; D05 e revisão independente continuam pendentes.

```bash
CVG_PROGRAM_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3 CVG_RUNTIME_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3/evidencias/prod-13/r3-prod13-20260914-a1/runtime CVG_EVIDENCE_SEGMENT=r3-prod13-20260914-a1 AAA_RUN_ID=r3-prod13-20260914-a1 AAA_WORKER_INDEX=39 AAA_ATTEMPT=1 pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-13.test.ts
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

A prova R3 cobre budget durável/concorrente e workflow de ferramentas com deny-default, hash do payload original, CAS, expiração, sanitização e falhas fail-closed; D05, provider externo e revisão independente permanecem pendentes.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-13/r3-prod13-20260914-a1/manifest.json, evidencias/prod-13/r3-prod13-20260914-a1/prod-13.test.log, evidencias/prod-13/r3-prod13-20260914-a1/prod-13-evidence.json, evidencias/prod-13/r3-prod13-20260914-a1/runtime/environment/isolated-env.json

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
