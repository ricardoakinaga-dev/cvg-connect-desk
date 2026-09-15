# PROD-10 — Mover Secretary para execução durável assíncrona

**Observação da auditoria:** 7/7 testes R3 passam em segmento próprio r3-prod10-20260914-a2; sandboxes externos controlados e revisão independente permanecem pendentes.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** BE-A01, R3-BE01

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-10 / estado recebido PLANNED

**Estado:** REVIEW · **Prioridade:** P0 · **Marco:** M1 · **Estimativa relativa:** 8

**Dono funcional:** Backend integrações · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE13, BE01, BE09, BE11

**Dependências:** [PROD-09](PROD-09.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts`
- `modules/secretary-adapter/src`
- `apps/message-worker/src`
- `packages/messaging-contracts/src`
- `apps/desk-api/src/__tests__/production/prod-10.test.ts`

**Locks:** worker-runtime

## Critérios de aceite

- **PROD-10-AC1** — Webhook confirma apenas recibo/persistência; intenção de invocação Secretary comita junto e worker efetivamente processa, removendo espera de IA do caminho síncrono.
- **PROD-10-AC2** — Crash após commit antes invocar ou responder recupera job; duplicata inbound não perde invocação; idempotência/reconciliação externa registra unknown quando provider não oferece confirmação.
- **PROD-10-AC3** — Timeout/retry limitado e degradação preservam atendimento humano; cancelamento por handoff humano/estado antigo impede resposta tardia indevida.
- **PROD-10-AC4** — Contratos Gateway/Secretary e eventos versionados preservados com testes de consumidor real/sandbox; sem reescrever provider ou introduzir transporte paralelo.
- **PROD-10-R2-AC5** — unknown não reabre automaticamente sem contrato de idempotência/reconciliação do provider. Preservar causa, resultado e checkpoint duráveis; distinguir execução de IA da entrega. Provar timeout após efeito, crash após resposta e antes de gravação, replay concorrente e handoff durante execução. Não chamar store simulado de prova distribuída.
- **PROD-10-R3-AC1** — Matar processo logo após begin, após resposta IA e antes da persistência/entrega; restart converge por resultado persistido ou reconciliação explicitamente pendente, nunca mero ACK de trabalho perdido; provar uma chamada externa.

## Verificação proposta

Estado: **PASS**. Ambiente: Candidato R3 com PostgreSQL/Redis isolados, app HTTP real, sandbox HTTP local controlado de Secretary e Gateway e processos reais de worker; nenhum provider externo..

7/7 testes locais passam sem skip; limites de provider externo permanecem explícitos.

```bash
CVG_PROGRAM_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3 CVG_RUNTIME_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3/evidencias/prod-10/r3-prod10-20260914-a2/runtime CVG_EVIDENCE_SEGMENT=r3-prod10-20260914-a2 AAA_RUN_ID=r3-prod10-20260914-a2 AAA_WORKER_INDEX=24 AAA_ATTEMPT=2 pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-10.test.ts
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

7/7 testes R3 passam com app, PostgreSQL/Redis e sandboxes HTTP locais reais, cobrindo webhook assíncrono, crash/replay, unknown, handoff e entrega idempotente; provider externo não foi alegado.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-10/r3-prod10-20260914-a2/manifest.json, evidencias/prod-10/r3-prod10-20260914-a2/prod-10-evidence.json, evidencias/prod-10/r3-prod10-20260914-a2/runtime/environment/isolated-env.json, evidencias/prod-10/r3-prod10-20260914-a2/prod-10.test.log

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
