# PROD-09 — Garantir efeitos idempotentes de worker e falhas observáveis

**Observação da auditoria:** Handler Err agora gera falha, ACK/NACK são observados e efeitos têm dedup; falta prova integrada sob lease longo.

**Tratamento:** COMPLETE_AND_VERIFY · PARTIAL_REQUIRES_VERIFICATION

**Achados:** Sem achado individual; completar/revalidar os aceites.

**Origem:** CVG-PRODUCTION-20260913 / PROD-09 / estado recebido IMPLEMENTED

**Estado:** PLANNED · **Prioridade:** P0 · **Marco:** M1 · **Estimativa relativa:** 5

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

Estado: **NOT_RUN**. Ambiente: Ambiente sintético próprio; URL/identidade antes de imports. Testes reais usam runner validado e artifacts fora do histórico..

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-09.test.ts
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
