# PROD-05 — Provar sessão, rotação e revalidação HTTP/WS

**Observação da auditoria:** Sessão opaca, deadlines e rotação preservados; provas submetidas não substituem nova execução no candidato integrado.

**Tratamento:** COMPLETE_AND_VERIFY · PARTIAL_REQUIRES_VERIFICATION

**Achados:** Sem achado individual; completar/revalidar os aceites.

**Origem:** CVG-PRODUCTION-20260913 / PROD-05 / estado recebido IMPLEMENTED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M1 · **Estimativa relativa:** 3

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

Estado: **NOT_RUN**. Ambiente: Ambiente sintético próprio; URL/identidade antes de imports. Testes reais usam runner validado e artifacts fora do histórico..

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-05.test.ts
```

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Reproduzir o estado observado e os achados deste cartão no candidato congelado; separar correção, complemento e prova pendente.

**Sinal de conclusão da ação:** Reprodução/limites e subtarefas com aceites registrados, sem perder trabalho entregue.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
