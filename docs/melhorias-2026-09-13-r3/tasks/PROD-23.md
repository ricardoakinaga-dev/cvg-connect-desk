# PROD-23 — Completar alertas acionáveis e geração operacional

**Observação da auditoria:** FE10 OPEN: alertas sem link ao recurso exato; geração e sincronização precisam prova real.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** FE10

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-23 / estado recebido PLANNED

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

Estado: **NOT_RUN**. Ambiente: synthetic-isolated.

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm exec playwright test e2e/production/prod-23.spec.ts --config playwright.production.config.ts
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

FE10 OPEN: alertas sem link ao recurso exato; geração e sincronização precisam prova real. Registrar subtarefas de correção e prova conforme aceites, preservando o comportamento já correto.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
