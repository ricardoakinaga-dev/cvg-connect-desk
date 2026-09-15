# PROD-19 — Entregar Inbox com contexto e operação completos

**Observação da auditoria:** FE02/03 OPEN: transferência inerte, contexto incompleto e busca apenas no lote sem request. Completar API/UI existente e propagar versão obrigatória de PROD18.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** BE-A06, FE02, FE03

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-19 / estado recebido PLANNED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M2 · **Estimativa relativa:** 13

**Dono funcional:** Frontend atendimento + API consultas · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** UI03, UI05, UI12, BE17

**Dependências:** [PROD-17](PROD-17.md), [PROD-18](PROD-18.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `apps/desk-web/src/pages/Inbox.tsx`
- `apps/desk-web/src/pages/Inbox.css`
- `apps/desk-web/src/lib/api.ts`
- `apps/desk-web/src/features/inbox`
- `modules/chat/src/presentation/http`
- `modules/chat/src/infrastructure/repositories/conversation.repository.ts`
- `e2e/production/prod-19.spec.ts`

**Locks:** web-contract-inbox

## Critérios de aceite

- **PROD-19-AC1** — Operador atribui, altera estado, faz handoff/transferência e gerencia tags, tutor/paciente/tarefas/notas/alertas no contexto; remover disabled permanente só com API funcional e autorização.
- **PROD-19-AC2** — Painel exibe dados humanos e links para recurso exato, não /contacts genérico; criar tarefa/nota preenche conversa/tutor/paciente sem exigir ID técnico.
- **PROD-19-AC3** — Busca/filtros por status/label/responsável/setor no conjunto autorizado do servidor e paginados, inclusive fora da primeira página; deep-link carrega recurso autorizado.
- **PROD-19-AC4** — Realtime/polling reconciliam detalhe do mesmo ID, status e contadores sem perder rascunho/foco ou saltar histórico; ações concorrentes/negadas têm feedback e recuperação.
- **PROD-19-R2-AC5** — Consumir as APIs operacionais entregues em PROD-18 e sua precondição de versão; atualizar DTOs/client, filtros server-side, contexto e conflito. Evitar implementar novamente transações backend já existentes.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: synthetic-isolated.

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm exec playwright test e2e/production/prod-19.spec.ts --config playwright.production.config.ts
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

FE02/03 OPEN: transferência inerte, contexto incompleto e busca apenas no lote sem request. Completar API/UI existente e propagar versão obrigatória de PROD18. Registrar subtarefas de correção e prova conforme aceites, preservando o comportamento já correto.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
