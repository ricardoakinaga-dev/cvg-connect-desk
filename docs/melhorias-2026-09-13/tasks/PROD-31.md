# PROD-31 — Endurecer logs, PII e métricas operacionais

**Observação da auditoria:** Aceites deste cartão ainda não encerrados; código existente deve ser revalidado e complementado, sem presumir ausência pela marca PLANNED.

**Tratamento:** IMPLEMENT_AND_VERIFY · REMAINING_SCOPE

**Achados:** Sem achado individual; completar/revalidar os aceites.

**Origem:** CVG-PRODUCTION-20260913 / PROD-31 / estado recebido PLANNED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M3 · **Estimativa relativa:** 5

**Dono funcional:** Backend observabilidade · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE19, OP12, BE14, BE20, BE11

**Dependências:** [PROD-09](PROD-09.md), [PROD-13](PROD-13.md), [PROD-16](PROD-16.md), [PROD-18](PROD-18.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `apps/desk-api/src/app.ts`
- `apps/message-worker/src`
- `apps/realtime-service/src`
- `packages/shared/src`
- `modules/secretary-adapter/src`
- `apps/desk-api/src/__tests__/production/prod-31.test.ts`

**Locks:** api-composition, realtime-runtime, worker-runtime

## Critérios de aceite

- **PROD-31-AC1** — Redaction recursiva cobre previews, objetos aninhados, erros de provider e console; não vazar token/email/phone/content em logs/traces/labels de métricas.
- **PROD-31-AC2** — /metrics protegido e labels por rota normalizada/valores finitos; 404/IDs aleatórios não criam cardinalidade ilimitada; carga confirma orçamento antes/depois.
- **PROD-31-AC3** — Métricas detectam backlog/idade/lease/retry/DLQ/processamento worker, atraso realtime e degradação; correlação/causação ligam eventos sem PII.
- **PROD-31-AC4** — Falha de exportação/observabilidade não derruba negócio, porém detectável; logs e audit de segurança cobrem sucesso/negação/falha e retenção D02.

## Verificação proposta

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-31.test.ts
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
