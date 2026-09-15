# PROD-42 — Executar entrada controlada em produção quando autorizada

**Observação da auditoria:** Aceites deste cartão ainda não encerrados; código existente deve ser revalidado e complementado, sem presumir ausência pela marca PLANNED.

**Tratamento:** IMPLEMENT_AND_VERIFY · REMAINING_SCOPE

**Achados:** Sem achado individual; completar/revalidar os aceites.

**Origem:** CVG-PRODUCTION-20260913 / PROD-42 / estado recebido PLANNED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M6 · **Estimativa relativa:** 5

**Dono funcional:** Operador de produção + lead · **Risco:** R3 · **Classe:** OPERACAO_CONDICIONAL

**Itens auditados:** OP09, OP11, OP12, OP16

**Dependências:** [PROD-41](PROD-41.md)

**Decisões:** D06

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `docs/melhorias-2026-09-13/evidencias/release`
- `infra/scripts`
- `docs/PRODUCTION_DEPLOYMENT.md`

**Locks:** Aplicar exclusão por arquivos e recursos do ambiente.

## Critérios de aceite

- **PROD-42-AC1** — Somente após autorização explícita válida vinculada ao pacote: aplicar migrations/deploy da imagem selada com backup/restauração ensaiada e janela/operador disponíveis.
- **PROD-42-AC2** — Piloto com escopo/canais/usuários acordados em D06; smoke seguro e autorizado confirma login,serviços,readiness,mensagem teste e WSS sem expor/enviar clientes reais inadvertidamente.
- **PROD-42-AC3** — Abortar/reverter ou roll-forward conforme plano se falha de autorização,dados,persistência,readiness ou critérios de SLO do piloto; registrar efeito parcial e reconciliação.
- **PROD-42-AC4** — Abrir tráfego progressivamente só com decisão observada e gates verdes; status IN_PRODUCTION significa observação real da implantação, não apenas CI verde.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: revisão documental; operação somente quando autorizada.

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Reproduzir o estado observado e os achados deste cartão no candidato congelado; separar correção, complemento e prova pendente.

**Sinal de conclusão da ação:** Reprodução/limites e subtarefas com aceites registrados, sem perder trabalho entregue.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
