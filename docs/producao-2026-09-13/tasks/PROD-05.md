# PROD-05 — Provar sessão, rotação e revalidação HTTP/WS

**Estado:** IMPLEMENTED · **Prioridade:** P1 · **Marco:** M1 · **Estimativa relativa:** 5

**Dono funcional:** Backend autenticação · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE03, UI01, BE06

**Dependências:** [PROD-01](PROD-01.md), [PROD-06](PROD-06.md)

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

## Verificação proposta

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Especificação de regressão a criar/adaptar após descoberta. Cobrir os aceites aplicáveis com casos positivos e negativos; exit 0 isolado não comprova o aceite integrado.

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-05.test.ts
```

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Sessao/rotacao/revalidacao provadas HTTP+PG+WS; 17/17 e 14/14. Aguarda revisao independente.

**Sinal de conclusão da ação:** Critico reproduz limites exatos, rotacao concorrente e corte WS <=5s.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-05/RELATORIO.md, evidencias/integration-runs/prod05/runner-summary.json, evidencias/integration-runs/prod05-ws/runner-summary.json

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
