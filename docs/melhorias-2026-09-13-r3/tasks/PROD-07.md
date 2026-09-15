# PROD-07 — Tornar recibo de webhook recuperável sem enfraquecer antirreplay

**Observação da auditoria:** 9/9 testes R3 passam em segmento próprio r3-prod07-20260914-a2; provider Gateway/Evolution e revisão independente permanecem pendentes.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** BE-A02, BE-A03

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-07 / estado recebido PLANNED

**Estado:** REVIEW · **Prioridade:** P0 · **Marco:** M1 · **Estimativa relativa:** 5

**Dono funcional:** Backend ingresso/eventos · **Risco:** R3 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE09, BE08, BE13

**Dependências:** [PROD-01](PROD-01.md), [PROD-06](PROD-06.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `packages/shared/src/webhook-guard.ts`
- `packages/shared/src/webhook-anti-replay.ts`
- `modules/chat/src/presentation/http/webhook-inbound.controller.ts`
- `modules/chat/src/infrastructure/repositories/inbound-atomic.repository.ts`
- `packages/database/supabase/migrations`
- `apps/desk-api/src/__tests__/production/prod-07.test.ts`

**Locks:** schema-migrations

## Critérios de aceite

- **PROD-07-AC1** — Falha após HMAC válido e antes de commit permite retry legítimo do mesmo evento até persistir uma mensagem; evento concluído não reexecuta efeito.
- **PROD-07-AC2** — Definir lifecycle do recibo/inbox pending/committed/retryable/terminal vinculado a payload hash, origem e retenção; concorrentes reclamam atomicamente. Nunca remover HMAC/timestamp/dedup para corrigir retry.
- **PROD-07-AC3** — Testar bytes exatos, assinatura inválida, alteração de payload mesmo ID, skew de relógio, queda DB, crash antes/depois commit e reconexão; nenhum evento aceito some.
- **PROD-07-AC4** — Resposta ACK/erro respeita contrato Gateway real/sandbox e política de redelivery; logs e métricas distinguem repetição inofensiva de perda e de ataque.
- **PROD-07-R2-AC5** — Autenticar cada tentativa com HMAC/timestamp atual e comparar identidade/origem/payload estável. Mesmo evento failed e payload com timestamp renovado deve recuperar; payload alterado deve negar. Fechar ACK completed com Gateway real/sandbox e reconciliar divergência 409 versus 2xx nos contratos.

## Verificação proposta

Estado: **PASS**. Ambiente: Candidato R3 com PostgreSQL/Redis locais isolados e app HTTP real via buildDeskApiApp; HMAC, dedup, retry, concorrência e erros negativos cobertos; provider Gateway/Evolution não disponível..

9/9 testes locais passam sem skip; redelivery/provider externo permanece NOT_RUN e não vira PASS implícito.

```bash
CVG_PROGRAM_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3 CVG_RUNTIME_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3/evidencias/prod-07/r3-prod07-20260914-a2/runtime CVG_EVIDENCE_SEGMENT=r3-prod07-20260914-a2 AAA_RUN_ID=r3-prod07-20260914-a2 AAA_WORKER_INDEX=11 AAA_ATTEMPT=2 pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-07.test.ts
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

9/9 testes R3 passam com HTTP e PostgreSQL reais isolados, cobrindo retry, recibo, dedup por payload, concorrência, HMAC/timestamp e erro do banco; redelivery/provider oficial continua sem prova.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-07/r3-prod07-20260914-a2/manifest.json, evidencias/prod-07/r3-prod07-20260914-a2/webhook-replay-evidence.json, evidencias/prod-07/r3-prod07-20260914-a2/runtime/environment/isolated-env.json, evidencias/prod-07/r3-prod07-20260914-a2/prod-07.test.log

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
