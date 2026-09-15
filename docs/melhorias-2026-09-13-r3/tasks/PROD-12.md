# PROD-12 — Provar leases, DLQ e fanout entre processos

**Observação da auditoria:** 13/13 testes R3 passam em segmento próprio r3-prod12-20260914-a5 com PG/Redis isolados, processos filhos reais, 2 replicas realtime e SIGKILL; provas remotas/provider e revisão independente permanecem pendentes.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** BE-A01, R3-BE01

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-12 / estado recebido PLANNED

**Estado:** REVIEW · **Prioridade:** P1 · **Marco:** M1 · **Estimativa relativa:** 5

**Dono funcional:** Backend distribuído/QA · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE06, BE07, BE12

**Dependências:** [PROD-04](PROD-04.md), [PROD-09](PROD-09.md), [PROD-11](PROD-11.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `packages/events/src`
- `packages/realtime/src`
- `apps/realtime-service/src`
- `apps/message-worker/src`
- `modules/admin/src/presentation/http/dead-letter-persistent.controller.ts`
- `apps/desk-api/src/__tests__/production/prod-12.test.ts`
- `apps/desk-api/src/__tests__/production/prod-12-lease-child.ts`

**Locks:** realtime-runtime, worker-runtime

## Critérios de aceite

- **PROD-12-AC1** — PG/Redis e três réplicas reais: claim exclusivo, renewal, geração/owner, staleACK/NACK negados, queda de processo e lease expirado recuperáveis.
- **PROD-12-AC2** — ACK de worker não esconde evento de realtime/http-poll; reorder/duplicata/reconnect não vaza conteúdo nem duplica efeito lógico; HTTP cursor não avança sobre falha.
- **PROD-12-AC3** — DLQ sobrevive restart; retry administrativo tem autorização, claim concorrente único, sourceEvent imutável, audit e resultados de falha explícitos.
- **PROD-12-AC4** — Queda Redis/partição nó, backlog e pressão recebem backoff bounded e recuperação; UI recebe estado verdadeiro, não online fixo.
- **PROD-12-R2-AC5** — Com lote de50 e handler lento, validar validade dos leases de itens aguardando e em execução, renewal/claim sob demanda e fencing do efeito. Duas réplicas após expiração não podem repetir efeito externo nem perder resultado. Registrar se limitação do provider requer reconciliação.
- **PROD-12-R3-AC1** — Matar processo logo após begin, após resposta IA e antes da persistência/entrega; restart converge por resultado persistido ou reconciliação explicitamente pendente, nunca mero ACK de trabalho perdido; provar uma chamada externa.

## Verificação proposta

Estado: **PASS**. Ambiente: Candidato R3 com PostgreSQL/Redis isolados, desk-api, workers, 2 replicas realtime, fixture RPC versionada e SIGKILL reais; nenhum provider externo ou dado de produção..

13/13 testes passam; leases/renew/takeover/fencing, DLQ/replay HTTP, fanout autorizado em 2 replicas, revogação, crash e esgotamento de tentativas são cobertos; revisão independente continua pendente.

```bash
CVG_PROGRAM_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3 CVG_RUNTIME_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3/evidencias/prod-12/r3-prod12-20260914-a5/runtime CVG_EVIDENCE_SEGMENT=r3-prod12-20260914-a5 AAA_RUN_ID=r3-prod12-20260914-a5 AAA_WORKER_INDEX=40 AAA_ATTEMPT=5 pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-12.test.ts
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

13/13 testes R3 passam com PG/Redis isolados, processos filhos reais, 2 replicas realtime e SIGKILL; a fixture RPC versionada elimina dependência de evidência histórica. Provas remotas/provider e revisão independente permanecem pendentes.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-12/r3-prod12-20260914-a5/manifest.json, evidencias/prod-12/r3-prod12-20260914-a5/prod-12.test.log, evidencias/prod-12/r3-prod12-20260914-a5/prod-12-evidence.json, evidencias/prod-12/r3-prod12-20260914-a5/runtime/environment/isolated-env.json

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
