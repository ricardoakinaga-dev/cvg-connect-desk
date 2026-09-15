# PROD-30 — Completar atualização entre páginas e validade dos KPIs

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M3 · **Estimativa relativa:** 5

**Dono funcional:** Frontend dados + dashboard backend · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** UI06, UI08, UI09, UI10, UI12, BE17, BE19

**Dependências:** [PROD-21](PROD-21.md), [PROD-22](PROD-22.md), [PROD-23](PROD-23.md), [PROD-24](PROD-24.md), [PROD-25](PROD-25.md), [PROD-26](PROD-26.md), [PROD-27](PROD-27.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `apps/desk-web/src/lib`
- `apps/desk-web/src/features`
- `apps/desk-web/src/pages/Dashboard.tsx`
- `modules/dashboard/src`
- `modules/chat/src/infrastructure/repositories`
- `e2e/production/prod-30.spec.ts`

**Locks:** web-contract-inbox

## Critérios de aceite

- **PROD-30-AC1** — Tasks/Alerts/Kanban/Contacts/Dashboard recebem invalidação real ou polling bounded conforme contrato; stale/offline visível e reconsulta após reconexão sem double fetch storm.
- **PROD-30-AC2** — KPIs seguem fórmulas doc13 no backend com janela explicitamente atual; null/sem dados não é zero fabricado, horário retornado e falha parcial acessíveis.
- **PROD-30-AC3** — Testes de cálculo em PG cobrem inbound/outbound humanos/bot/null legado, múltiplas mensagens, handoff, aging vazio e cross-sector conforme permissão de gestor.
- **PROD-30-AC4** — Filtros/search/paginação e atualizações não vazam dados, repetem efeitos ou sobrescrevem edição suja; padrões de cache e atualização documentados.

## Verificação proposta

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Especificação de regressão a criar/adaptar após descoberta. Cobrir os aceites aplicáveis com casos positivos e negativos; exit 0 isolado não comprova o aceite integrado.

```bash
pnpm exec playwright test e2e/production/prod-30.spec.ts --config playwright.production.config.ts
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
