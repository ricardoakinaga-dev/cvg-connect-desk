# PROD-05 — Provar sessão, rotação e revalidação HTTP/WS

**Observação da auditoria:** Revalidação atual FAIL: antes dos17 testes, realtime-child encerra por import metrics ESM/CJS. Restaurar bootstrap em PROD44, então reexecutar a suíte isolada e completar bordas de sessão/rotação.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** R3-RT01

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-05 / estado recebido PLANNED

**Estado:** REVIEW · **Prioridade:** P0 · **Marco:** M1 · **Estimativa relativa:** 3

**Dono funcional:** Backend autenticação · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE03, UI01, BE06

**Dependências:** [PROD-01](PROD-01.md), [PROD-06](PROD-06.md), [PROD-44](PROD-44.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `packages/auth/src/session-policy.ts`
- `packages/auth/src/infrastructure/repositories/auth.repository.ts`
- `packages/auth/src/middleware.ts`
- `apps/desk-api/src/__tests__`
- `apps/desk-api/src/__tests__/production/prod-05.test.ts`

**Locks:** auth-contract

## Critérios de aceite

- **PROD-05-AC1** — Preservar tokens opacos só hash e C01: 7d normal/30d absoluto/24h idle; no limite exato negar; legado mantém deadline absoluto original.
- **PROD-05-AC2** — HTTP+PG reais demonstram login/logout/me/rotate/logout-all, usuário desativado, duas rotações concorrentes com um vencedor, relógio/timezone diferente, sem extensão indevida.
- **PROD-05-AC3** — Revalidação WS e sucessor de sessão usam mesma política; 401/403 e falha de rede distintos. Tokens não entram em URL/log nem novas migrations apagam sessão sem estratégia.
- **PROD-05-AC4** — Pré-check/boot não exige JWT como arquitetura; identificar e resolver variáveis legadas inconsistentes conforme configuração efetiva.
- **PROD-05-R3-AC1** — Após PROD44, executar os17 testes PROD05 em ambiente próprio com subprocesso nativo iniciando corretamente. Provar sessão/rotação/revalidação HTTP/WS e preservar matriz /metrics503/401/200. A imagem real é aceite posterior PROD36/35 e não condição para fechar PROD05.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: Ambiente sintético próprio; URL/identidade antes de imports. Testes reais usam runner validado e artifacts fora do histórico..

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-05.test.ts
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Revalidação atual FAIL: antes dos17 testes, realtime-child encerra por import metrics ESM/CJS. Restaurar bootstrap em PROD44, então reexecutar a suíte isolada e completar bordas de sessão/rotação. Registrar subtarefas de correção e prova conforme aceites, preservando o comportamento já correto.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
