# PROD-10 — Mover Secretary para execução durável assíncrona

**Estado:** IMPLEMENTED · **Prioridade:** P1 · **Marco:** M1 · **Estimativa relativa:** 8

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

## Verificação proposta

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Especificação de regressão a criar/adaptar após descoberta. Cobrir os aceites aplicáveis com casos positivos e negativos; exit 0 isolado não comprova o aceite integrado.

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-10.test.ts
```

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Secretary assincrona duravel com recibo e DLQ; 7/7 em 3 rodadas. Aguarda revisao independente.

**Sinal de conclusão da ação:** Critico reproduz webhook rapido, crash antes da invocacao e uma unica resposta.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-10/RELATORIO.md

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
