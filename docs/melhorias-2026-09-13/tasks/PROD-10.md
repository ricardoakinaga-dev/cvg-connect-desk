# PROD-10 — Mover Secretary para execução durável assíncrona

**Observação da auditoria:** Suíte atual 7/7 PG+Redis com providers simulados confirma async/crash; unknown ainda é reaberto automaticamente.

**Tratamento:** REPAIR_AND_VERIFY · REWORK

**Achados:** BE-A01

**Origem:** CVG-PRODUCTION-20260913 / PROD-10 / estado recebido IMPLEMENTED

**Estado:** PLANNED · **Prioridade:** P0 · **Marco:** M1 · **Estimativa relativa:** 8

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

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: Ambiente sintético próprio; URL/identidade antes de imports. Testes reais usam runner validado e artifacts fora do histórico..

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-10.test.ts
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
