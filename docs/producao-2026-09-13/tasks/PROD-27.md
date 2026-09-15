# PROD-27 — Completar Kanban funcional e sincronizado

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M2 · **Estimativa relativa:** 8

**Dono funcional:** Frontend board + API · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** UI10, UI05, BE04

**Dependências:** [PROD-18](PROD-18.md), [PROD-19](PROD-19.md), [PROD-24](PROD-24.md)

**Decisões:** D04

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `apps/desk-web/src/pages/Kanban.tsx`
- `apps/desk-web/src/pages/Kanban.css`
- `apps/desk-web/src/lib/api.ts`
- `modules/kanban/src`
- `e2e/production/prod-27.spec.ts`

**Locks:** web-contract-inbox

## Critérios de aceite

- **PROD-27-AC1** — Card abre conversa correta e mostra contexto relevante autorizado; drag/drop e alternativa select por teclado/toque usam mutação atômica validada.
- **PROD-27-AC2** — Filtros agente/labels/prioridade/período/grupo/setor funcionam sobre conjunto autorizado; ordenação e contagem consistentes e dados ausentes tratados.
- **PROD-27-AC3** — Realtime/refresh sincroniza outro operador e recupera erro/conflito sem movimento fantasma; mudança de setor corta acesso anterior.
- **PROD-27-AC4** — D04 resolve trilhas custom e expansões doc22: implementar se parte do escopo ratificado; deferimento exige item/dono/data e justificativa explícitos sem marcar recurso entregue. Núcleo/filtros não podem ser excluídos para passar.

## Verificação proposta

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Especificação de regressão a criar/adaptar após descoberta. Cobrir os aceites aplicáveis com casos positivos e negativos; exit 0 isolado não comprova o aceite integrado.

```bash
pnpm exec playwright test e2e/production/prod-27.spec.ts --config playwright.production.config.ts
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
