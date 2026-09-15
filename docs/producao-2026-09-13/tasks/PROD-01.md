# PROD-01 — Fechar contratos e decisões de escopo/produção

**Estado:** IMPLEMENTED · **Prioridade:** P1 · **Marco:** M0 · **Estimativa relativa:** 5

**Dono funcional:** Lead + donos de produto/dados/operação · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE01, BE02, BE03, BE04, BE20, DT01, UI05, UI10, UI13, OP16

**Dependências:** [PROD-00](PROD-00.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `docs/producao-2026-09-13/CONTRATOS.md`
- `docs/producao-2026-09-13/DECISOES.md`

**Locks:** Aplicar exclusão por arquivos e recursos do ambiente.

## Critérios de aceite

- **PROD-01-AC1** — Publicar contratos C01–C10 definidos em CONTRATOS.md com produtor, consumidor, payload positivo/negativo, erro, versão, compatibilidade e evidência requerida; ratificar os recortes já congelados sem redesenhar sessão ou canal.
- **PROD-01-AC2** — Registrar decisões D01–D06 com dono e alcance: permissões efetivas, dados/retencão, tutor-paciente, expansões Kanban, ferramentas IA e condições operacionais. Decisão não tomada bloqueia só ação dependente; não inventar ratificação.
- **PROD-01-AC3** — Manter todos os 55 itens cobertos; funcionalidades já completas recebem validação, não reimplementação. Cada possível exclusão precisa origem, motivo, dono e registro explícito; não classificar ausência como concluída.
- **PROD-01-AC4** — Distinguir implementação autorizada por futura solicitação, aprovação técnica e implantação externa; plano atual não inicia nenhuma delas.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: revisão documental; operação somente quando autorizada.

Revisão registrada requisito por requisito, links a artefatos e identidade do candidato. Decisões humanas e observação de campo não são substituídas por teste automatizado.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Contratos e decisoes publicados; aguarda revisao independente do lote M0.

**Sinal de conclusão da ação:** Critico fresco aprova CONTRATOS/DECISOES sem achado bloqueante.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-01/VALIDACAO.md

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
