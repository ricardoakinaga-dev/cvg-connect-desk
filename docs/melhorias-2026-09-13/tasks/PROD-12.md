# PROD-12 — Provar leases, DLQ e fanout entre processos

**Observação da auditoria:** Owner/generation, fanout e DLQ existem; validar renewal efetivo sob lote50 sequencial e provider lento, além de failover real.

**Tratamento:** COMPLETE_AND_VERIFY · PARTIAL_REQUIRES_VERIFICATION

**Achados:** BE-A01

**Origem:** CVG-PRODUCTION-20260913 / PROD-12 / estado recebido IMPLEMENTED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M1 · **Estimativa relativa:** 5

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

**Locks:** realtime-runtime, worker-runtime

## Critérios de aceite

- **PROD-12-AC1** — PG/Redis e três réplicas reais: claim exclusivo, renewal, geração/owner, staleACK/NACK negados, queda de processo e lease expirado recuperáveis.
- **PROD-12-AC2** — ACK de worker não esconde evento de realtime/http-poll; reorder/duplicata/reconnect não vaza conteúdo nem duplica efeito lógico; HTTP cursor não avança sobre falha.
- **PROD-12-AC3** — DLQ sobrevive restart; retry administrativo tem autorização, claim concorrente único, sourceEvent imutável, audit e resultados de falha explícitos.
- **PROD-12-AC4** — Queda Redis/partição nó, backlog e pressão recebem backoff bounded e recuperação; UI recebe estado verdadeiro, não online fixo.
- **PROD-12-R2-AC5** — Com lote de50 e handler lento, validar validade dos leases de itens aguardando e em execução, renewal/claim sob demanda e fencing do efeito. Duas réplicas após expiração não podem repetir efeito externo nem perder resultado. Registrar se limitação do provider requer reconciliação.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: Ambiente sintético próprio; URL/identidade antes de imports. Testes reais usam runner validado e artifacts fora do histórico..

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-12.test.ts
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
