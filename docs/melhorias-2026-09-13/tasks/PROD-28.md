# PROD-28 — Modularizar frontend e unificar componentes/estados

**Observação da auditoria:** Aceites deste cartão ainda não encerrados; código existente deve ser revalidado e complementado, sem presumir ausência pela marca PLANNED.

**Tratamento:** IMPLEMENT_AND_VERIFY · REMAINING_SCOPE

**Achados:** FE16

**Origem:** CVG-PRODUCTION-20260913 / PROD-28 / estado recebido PLANNED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M3 · **Estimativa relativa:** 8

**Dono funcional:** Frontend arquitetura/design · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** UI14, UI15, BE01, DT02

**Dependências:** [PROD-20](PROD-20.md), [PROD-21](PROD-21.md), [PROD-22](PROD-22.md), [PROD-23](PROD-23.md), [PROD-24](PROD-24.md), [PROD-25](PROD-25.md), [PROD-26](PROD-26.md), [PROD-27](PROD-27.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `apps/desk-web/src/features`
- `apps/desk-web/src/components/ui`
- `apps/desk-web/src/pages`
- `apps/desk-web/src/lib`
- `apps/desk-web/src/index.css`
- `docs/design`
- `apps/desk-web/src/__tests__/production/prod-28.test.tsx`

**Locks:** design-system, web-contract-inbox

## Critérios de aceite

- **PROD-28-AC1** — Extrair Inbox/Admin/Contacts em features/hooks/componentes com ownership de consultas e mutações; preservar contratos e fluxos aprovados, sem segunda API ou store paralela.
- **PROD-28-AC2** — Adotar tokens e primitivos nos estados loading/empty/error/forbidden/partial/success e controles; reduzir literais CSS/normalizações duplicadas por substituição semântica, não meta de linhas arbitrária.
- **PROD-28-AC3** — Atualizar ledger de adoção por página/estado a partir do código final; propriedades da marca, textos de produto e recursos preservados.
- **PROD-28-AC4** — Antes/depois com mesmos testes e capturas, regressão de fluxo completa e DAG/imports sem ciclo; refactor não esconde mudança comportamental.
- **PROD-28-AC5** — Extrações mínimas necessárias aos fluxos podem ser subtarefas das tarefas UI predecessoras, sob dono único por arquivo; esta tarefa fecha a composição integrada, sem exigir reescrita geral.

## Verificação proposta

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm --filter @cvg/desk-web exec vitest run src/__tests__/production/prod-28.test.tsx
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
