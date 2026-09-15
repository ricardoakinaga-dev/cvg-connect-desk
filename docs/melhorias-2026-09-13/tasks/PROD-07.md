# PROD-07 — Tornar recibo de webhook recuperável sem enfraquecer antirreplay

**Observação da auditoria:** Recibo claim/complete/fail existe. Retry com HMAC renovado falha e ACK completed diverge entre documento e código.

**Tratamento:** REPAIR_AND_VERIFY · REWORK

**Achados:** BE-A02, BE-A03

**Origem:** CVG-PRODUCTION-20260913 / PROD-07 / estado recebido IMPLEMENTED

**Estado:** PLANNED · **Prioridade:** P0 · **Marco:** M1 · **Estimativa relativa:** 5

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

Estado: **NOT_RUN**. Ambiente: Ambiente sintético próprio; URL/identidade antes de imports. Testes reais usam runner validado e artifacts fora do histórico..

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-07.test.ts
```

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Reproduzir o estado observado e os achados deste cartão no candidato congelado; separar correção, complemento e prova pendente.

**Sinal de conclusão da ação:** Reprodução/limites e subtarefas com aceites registrados, sem perder trabalho entregue.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
