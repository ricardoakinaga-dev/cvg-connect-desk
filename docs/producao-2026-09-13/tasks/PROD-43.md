# PROD-43 — Concluir estabilização e medir SLO de campo

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M7 · **Estimativa relativa:** 5

**Dono funcional:** SRE/operação + lead · **Risco:** R2 · **Classe:** OPERACAO_CONDICIONAL

**Itens auditados:** OP15, OP08, OP12, OP16, UI16

**Dependências:** [PROD-42](PROD-42.md)

**Decisões:** D06

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `docs/producao-2026-09-13/evidencias/operacao`
- `docs/SLO.md`
- `docs/RUNBOOK.md`
- `docs/DISASTER_RECOVERY.md`

**Locks:** Aplicar exclusão por arquivos e recursos do ambiente.

## Critérios de aceite

- **PROD-43-AC1** — Cumprir janela de estabilização definida antes do piloto; monitorar perdas/efeitos duplicados/authz/backlog/latência e acionar incidente com dono e mitigação, sem ocultar violações.
- **PROD-43-AC2** — Observar janela mensal declarada para 99.9%API/99.95% webhook; ausência de 30 dias não vira SLO comprovado, mas não cria dependência circular que proíbe o primeiro deploy.
- **PROD-43-AC3** — Confirmar backups agendados,rotina restauração,expiração exceções supplychain e privacidade/retention; dashboards e alertas com operador respondendo.
- **PROD-43-AC4** — Reauditoria de 55itens e relatório de evidência de campo separado de laboratório; melhorias residuais viram backlog com owner/prazo, CLOSED só quando observações requeridas terminarem.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: revisão documental; operação somente quando autorizada.

Revisão registrada requisito por requisito, links a artefatos e identidade do candidato. Decisões humanas e observação de campo não são substituídas por teste automatizado.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Revalidar os achados e predecessores desta tarefa no candidato atual, antes de editar.

**Sinal de conclusão da ação:** Mapa achado→caminho real e reprodução/limite atual registrados no retorno.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
