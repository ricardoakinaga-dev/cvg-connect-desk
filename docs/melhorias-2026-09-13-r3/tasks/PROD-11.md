# PROD-11 — Validar reconciliação outbound e retenção da intenção

**Observação da auditoria:** 12/12 testes R3 passam em segmento próprio r3-prod11-20260914-a5; crash real, retry deduplicado, callback assinado, TTL/tombstone e reconciliação estão cobertos; provider externo e revisão independente permanecem pendentes.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** Sem achado individual; completar/revalidar os aceites.

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-11 / estado recebido PLANNED

**Estado:** REVIEW · **Prioridade:** P1 · **Marco:** M1 · **Estimativa relativa:** 3

**Dono funcional:** Backend outbound · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE10, BE15, UI04

**Dependências:** [PROD-08](PROD-08.md), [PROD-10](PROD-10.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `modules/chat/src/application/use-cases/send-outbound-message.use-case.ts`
- `modules/chat/src/infrastructure/repositories/outbound-atomic.repository.ts`
- `modules/chat/src/infrastructure/repositories/outbound-delivery.repository.ts`
- `modules/gateway-adapter/src`
- `packages/messaging-contracts/src`
- `apps/desk-api/src/__tests__/production/prod-11.test.ts`
- `scripts/production/prod-11-crash-send.ts`

**Locks:** Aplicar exclusão por arquivos e recursos do ambiente.

## Critérios de aceite

- **PROD-11-AC1** — Mesma intenção ator+conversa+payload retorna mesmo resultado; payload conflitante409; corrida tem um efeito e TTL não permite reenvio silencioso após expiração.
- **PROD-11-AC2** — ACK externo perdido,429,reset/timeout/deadline e callback atrasado/outra versão resultam em estado correto pending/sent/failed/unknown_reconciling; nunca reenviar cegamente.
- **PROD-11-AC3** — Mapping+message+outbox atômicos e callback autorizado/idempotente; replay após restart com prova durável e janela de rollout writer antigo detectada.
- **PROD-11-AC4** — Gateway/Secretary sandbox oficial distinguido de mock; resultados de entrega reais usados pela UI, limites de taxa e retry documentados.

## Verificação proposta

Estado: **PASS**. Ambiente: Candidato R3 com PostgreSQL/Redis isolados, app HTTP real, sandbox HTTP local controlado do Gateway e processo filho real; nenhum provider externo ou dado de produção..

12/12 testes locais passam sem skip; crash real entre envio e callback, retry deduplicado, callback assinado e retenção/tombstone permanecem observáveis; revisão independente continua pendente.

```bash
CVG_PROGRAM_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3 CVG_RUNTIME_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3/evidencias/prod-11/r3-prod11-20260914-a5/runtime CVG_EVIDENCE_SEGMENT=r3-prod11-20260914-a5 AAA_RUN_ID=r3-prod11-20260914-a5 AAA_WORKER_INDEX=38 AAA_ATTEMPT=5 pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-11.test.ts
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

12/12 testes R3 passam com PostgreSQL/Redis isolados, app HTTP real, sandbox local do Gateway e processo filho morto entre envio e callback; retry não reenvia e callback resolve a intenção uma vez. Provider externo e revisão independente permanecem fora da prova.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-11/r3-prod11-20260914-a5/manifest.json, evidencias/prod-11/r3-prod11-20260914-a5/crash-send.ts, evidencias/prod-11/r3-prod11-20260914-a5/prod-11-evidence.json, evidencias/prod-11/r3-prod11-20260914-a5/runtime/environment/isolated-env.json, evidencias/prod-11/r3-prod11-20260914-a5/prod-11.test.log

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
