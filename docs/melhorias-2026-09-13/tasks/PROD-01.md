# PROD-01 — Fechar contratos e decisões de escopo/produção

**Observação da auditoria:** C01–C10 e D01–D06 documentados, mas contratos repetem lacunas já alteradas; decisões permanecem abertas.

**Tratamento:** COMPLETE_AND_VERIFY · PARTIAL_REQUIRES_VERIFICATION

**Achados:** BE-A03, DOC01

**Origem:** CVG-PRODUCTION-20260913 / PROD-01 / estado recebido IMPLEMENTED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M0 · **Estimativa relativa:** 3

**Dono funcional:** Lead + donos de produto/dados/operação · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE01, BE02, BE03, BE04, BE20, DT01, UI05, UI10, UI13, OP16

**Dependências:** [PROD-00](PROD-00.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `docs/melhorias-2026-09-13/CONTRATOS.md`
- `docs/melhorias-2026-09-13/DECISOES.md`

**Locks:** Aplicar exclusão por arquivos e recursos do ambiente.

## Critérios de aceite

- **PROD-01-AC1** — Publicar contratos C01–C10 definidos em CONTRATOS.md com produtor, consumidor, payload positivo/negativo, erro, versão, compatibilidade e evidência requerida; ratificar os recortes já congelados sem redesenhar sessão ou canal.
- **PROD-01-AC2** — Registrar decisões D01–D06 com dono e alcance: permissões efetivas, dados/retencão, tutor-paciente, expansões Kanban, ferramentas IA e condições operacionais. Decisão não tomada bloqueia só ação dependente; não inventar ratificação.
- **PROD-01-AC3** — Manter todos os 55 itens cobertos; funcionalidades já completas recebem validação, não reimplementação. Cada possível exclusão precisa origem, motivo, dono e registro explícito; não classificar ausência como concluída.
- **PROD-01-AC4** — Distinguir implementação autorizada por futura solicitação, aprovação técnica e implantação externa; plano atual não inicia nenhuma delas.

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
