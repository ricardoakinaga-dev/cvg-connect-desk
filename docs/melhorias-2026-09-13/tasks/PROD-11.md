# PROD-11 — Validar reconciliação outbound e retenção da intenção

**Observação da auditoria:** Reconciliação/tombstone outbound entregue; fechar confirmação de provider e prova atual da janela de rollout.

**Tratamento:** COMPLETE_AND_VERIFY · PARTIAL_REQUIRES_VERIFICATION

**Achados:** Sem achado individual; completar/revalidar os aceites.

**Origem:** CVG-PRODUCTION-20260913 / PROD-11 / estado recebido IMPLEMENTED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M1 · **Estimativa relativa:** 3

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

**Locks:** Aplicar exclusão por arquivos e recursos do ambiente.

## Critérios de aceite

- **PROD-11-AC1** — Mesma intenção ator+conversa+payload retorna mesmo resultado; payload conflitante409; corrida tem um efeito e TTL não permite reenvio silencioso após expiração.
- **PROD-11-AC2** — ACK externo perdido,429,reset/timeout/deadline e callback atrasado/outra versão resultam em estado correto pending/sent/failed/unknown_reconciling; nunca reenviar cegamente.
- **PROD-11-AC3** — Mapping+message+outbox atômicos e callback autorizado/idempotente; replay após restart com prova durável e janela de rollout writer antigo detectada.
- **PROD-11-AC4** — Gateway/Secretary sandbox oficial distinguido de mock; resultados de entrega reais usados pela UI, limites de taxa e retry documentados.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: Ambiente sintético próprio; URL/identidade antes de imports. Testes reais usam runner validado e artifacts fora do histórico..

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-11.test.ts
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
