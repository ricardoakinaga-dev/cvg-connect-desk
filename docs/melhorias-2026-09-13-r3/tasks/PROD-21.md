# PROD-21 — Completar tarefas vinculadas e atribuição

**Observação da auditoria:** FE07 OPEN: tarefas sem seletores de assignee/vínculos humanos; IDs técnicos e ausência de navegação contextual.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** FE07

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-21 / estado recebido PLANNED

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

Estado: **NOT_RUN**. Ambiente: synthetic-isolated.

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm exec playwright test e2e/production/prod-21.spec.ts --config playwright.production.config.ts
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

FE07 OPEN: tarefas sem seletores de assignee/vínculos humanos; IDs técnicos e ausência de navegação contextual. Registrar subtarefas de correção e prova conforme aceites, preservando o comportamento já correto.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
