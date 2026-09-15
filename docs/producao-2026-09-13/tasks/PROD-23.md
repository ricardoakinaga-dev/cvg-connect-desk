# PROD-23 — Completar alertas acionáveis e geração operacional

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M2 · **Estimativa relativa:** 8

**Dono funcional:** Backend alertas + frontend · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** UI08, BE11, BE19

**Dependências:** [PROD-09](PROD-09.md), [PROD-18](PROD-18.md), [PROD-17](PROD-17.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `apps/desk-web/src/pages/Alerts.tsx`
- `apps/desk-web/src/lib/api.ts`
- `modules/alerts/src`
- `apps/message-worker/src`
- `e2e/production/prod-23.spec.ts`

**Locks:** web-contract-inbox, worker-runtime

## Critérios de aceite

- **PROD-23-AC1** — Ack/resolve e link à conversa/tarefa são autorizados, auditados com ator real e atualizam lista em tempo hábil sem refresh manual obrigatório.
- **PROD-23-AC2** — Inventariar regras prometidas (prazo/tarefa vencida, conversa sem resposta/handoff pendente, falha envio/Secretary); completar as regras operacionais adotadas sem inventar diagnóstico clínico automatizado.
- **PROD-23-AC3** — Scheduler/evento usa chave dedup por regra+recurso+janela e relógio testável; restart, duas réplicas e mudança de prazo não duplicam nem mantêm alerta inválido.
- **PROD-23-AC4** — Regra dispara e recupera via dado real sintético, UI não confunde erro com vazio; controles por severity/status, bulk apenas se contrato existir.

## Verificação proposta

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Especificação de regressão a criar/adaptar após descoberta. Cobrir os aceites aplicáveis com casos positivos e negativos; exit 0 isolado não comprova o aceite integrado.

```bash
pnpm exec playwright test e2e/production/prod-23.spec.ts --config playwright.production.config.ts
```

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Revalidar os achados e predecessores desta tarefa no candidato atual, antes de editar.

**Sinal de conclusão da ação:** Mapa achado→caminho real e reprodução/limite atual registrados no retorno.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
