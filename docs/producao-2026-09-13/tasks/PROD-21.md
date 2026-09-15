# PROD-21 — Completar tarefas vinculadas e atribuição

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M2 · **Estimativa relativa:** 5

**Dono funcional:** Frontend operação + tasks · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** UI06, BE05

**Dependências:** [PROD-18](PROD-18.md), [PROD-17](PROD-17.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `apps/desk-web/src/pages/Tasks.tsx`
- `apps/desk-web/src/pages/Tasks.css`
- `apps/desk-web/src/lib/api.ts`
- `modules/tasks/src`
- `e2e/production/prod-21.spec.ts`

**Locks:** web-contract-inbox

## Critérios de aceite

- **PROD-21-AC1** — Criar/editar atribuição, prazo/prioridade/status e vínculos conversa/tutor/paciente; seletores autorizados mostram nomes e contexto, não ID truncado.
- **PROD-21-AC2** — Abrir conversa vinculada preserva contexto e deep-link; filtros server-side ou paginação transparente não escondem tarefas fora do lote.
- **PROD-21-AC3** — Atualização realtime ou refresh acordado mostra mudanças de outro operador sem sobrescrever formulário sujo; overdue correto em timezone.
- **PROD-21-AC4** — Permissões, transições concorrentes, input inválido e falhas anunciam erro e preservam dados; testes HTTP+browser com vínculo persistido e audit.

## Verificação proposta

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Especificação de regressão a criar/adaptar após descoberta. Cobrir os aceites aplicáveis com casos positivos e negativos; exit 0 isolado não comprova o aceite integrado.

```bash
pnpm exec playwright test e2e/production/prod-21.spec.ts --config playwright.production.config.ts
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
