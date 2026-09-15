# PROD-09 — Garantir efeitos idempotentes de worker e falhas observáveis

**Estado:** IMPLEMENTED · **Prioridade:** P0 · **Marco:** M1 · **Estimativa relativa:** 8

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

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Especificação de regressão a criar/adaptar após descoberta. Cobrir os aceites aplicáveis com casos positivos e negativos; exit 0 isolado não comprova o aceite integrado.

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-09.test.ts
```

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Efeitos idempotentes, NACK/DLQ e crash/retomada provados; 13/13. Aguarda revisao.

**Sinal de conclusão da ação:** Critico reproduz crash pos-efeito com exatamente um alerta.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-09/RELATORIO.md

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
