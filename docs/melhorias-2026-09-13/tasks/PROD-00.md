# PROD-00 — Congelar candidato e ambiente de teste reproduzível

**Observação da auditoria:** Harness e baseline entregues; 6/42 hashes da baseline submetida diferem do candidato atual. Preservar fotografia antiga e selar nova.

**Tratamento:** COMPLETE_AND_VERIFY · PARTIAL_REQUIRES_VERIFICATION

**Achados:** OPS07, DOC01

**Origem:** CVG-PRODUCTION-20260913 / PROD-00 / estado recebido VERIFIED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M0 · **Estimativa relativa:** 3

**Dono funcional:** Lead + plataforma · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** OP06, DT02, BE01

**Dependências:** Nenhuma; ponto de partida.

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `e2e/support/aaa`
- `e2e/support/production`
- `playwright.production.config.ts`
- `scripts/production`
- `docs/melhorias-2026-09-13/evidencias`
- `scripts/production/prod-00.test.mjs`

**Locks:** Aplicar exclusão por arquivos e recursos do ambiente.

## Critérios de aceite

- **PROD-00-AC1** — Inventariar worktree sujo, HEAD, hashes de fontes/lock e imagens; reconciliar candidatos já presentes sem reset, limpeza ou substituição cega por HEAD.
- **PROD-00-AC2** — Reutilizar o harness AAA com runId, banco/Redis/bucket/portas próprios por worker, fixture marcada e teardown idempotente; recusar URL sem marcador e servidor alheio. Remover fuser/nomes fixos do caminho de teste utilizado.
- **PROD-00-AC3** — Criar configuração production que inclui novas suítes, valida identidade/isolamento e prova canário positivo/negativo do harness. Registrar disponibilidade de PostgreSQL/Redis/MinIO/ClamAV/OTel; serviço ausente bloqueia somente a prova dependente, nunca vira skip/PASS. Inventário e harness podem concluir sem todos os serviços disponíveis.
- **PROD-00-AC4** — Fixar Node/pnpm/lock atuais, seeds, relógio/timezone e concorrência; registrar baseline de checks disponíveis e perfil de carga especificado. Ausências recebem NOT_RUN/BLOCKED e dono na tarefa dependente; PROD-00 encerra inventário, identidade e isolamento sem alegar baseline funcional verde.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: Ambiente sintético próprio; URL/identidade antes de imports. Testes reais usam runner validado e artifacts fora do histórico..

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
node --test scripts/production/prod-00.test.mjs
```

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Congelar o worktree atual e comparar com sources-before.json da auditoria de entregas; estabelecer manifesto completo e recursos isolados.

**Sinal de conclusão da ação:** Candidato identificado, drift registrado e harness protegido sem exigir todos os serviços externos.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
