# PROD-44 — Restaurar bootstrap nativo realtime na fronteira ESM/CommonJS

**Observação da auditoria:** Revalidação atual FAIL: antes dos17 testes, realtime-child encerra por import metrics ESM/CJS. Restaurar bootstrap em PROD44, então reexecutar a suíte isolada e completar bordas de sessão/rotação.

**Tratamento:** FIX_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** R3-RT01

**Origem:** CVG-IMPROVEMENTS-20260913-R3 / PROD-44 / estado recebido NEW_FINDING

**Estado:** PLANNED · **Prioridade:** P0 · **Marco:** M0 · **Estimativa relativa:** 3

**Dono funcional:** Responsável realtime + integrador · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE18, OP09, OP10

**Dependências:** [PROD-00](PROD-00.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `apps/realtime-service/src/index.ts`
- `apps/realtime-service/src/__tests__`
- `apps/realtime-service/package.json`
- `packages/shared/src/index.ts`
- `packages/shared/package.json`
- `scripts/production`

**Locks:** realtime-runtime, shared-exports

## Critérios de aceite

- **PROD-44-AC1** — Reproduzir a falha de named export no entrypoint nativo. Corrigir interop sem remover métricas, relaxar Bearer ou trocar stack; preservar consumidores @cvg/shared.
- **PROD-44-AC2** — Regressão inicia subprocesso novo pelo comando tsx usado no Dockerfile, fora do carregamento Vitest. Runtime próprio responde readiness e fecha corretamente; capturar stdout/stderr/exit/Node/lock/source e teardown por PID próprio.
- **PROD-44-AC3** — No processo nativo, testar /metrics em produção: config sem token503, sem credencial/incorreta401, correta200. Validar o corpo Prometheus. Executar regressões realtime87 e AAA05 isolado14 sem exclusão oculta; PROD05 é revalidado depois em sua tarefa.
- **PROD-44-AC4** — Integrar teste nativo ao gate local e entregar regressão falhando antes/passando depois. A prova de imagem real permanece adicional em PROD36/35; não bloquear correção local na construção Docker.

## Verificação proposta

Estado: **TO_CREATE**. Ambiente: Subprocesso nativo Node/tsx, PG/Redis próprios quando boot exigir; produção sintética com demais config válidas. Não importar RealtimeServer via Vitest como substituto..

Antes:exit1 named export. Depois:inicialização e matrizHTTP503/401/200 observadas; regressões preservadas.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Reproduzir CLI atual e implementar interop mínima; registrar teste de subprocesso para evitar regressão invisível ao Vitest.

**Sinal de conclusão da ação:** Bootstrap nativo com HTTP observado e regressão integrada; liberar revalidação PROD05.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
