# PROD-13 — Fechar budget durável e workflow seguro de ferramentas IA

**Observação da auditoria:** Suíte atual11/11 PG confirma budget e approval; tools continuam desabilitadas com D05 aberta. Resolver fronteira unknown em PROD-10.

**Tratamento:** COMPLETE_AND_VERIFY · PARTIAL_REQUIRES_VERIFICATION

**Achados:** BE-A01

**Origem:** CVG-PRODUCTION-20260913 / PROD-13 / estado recebido IMPLEMENTED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M1 · **Estimativa relativa:** 5

**Dono funcional:** Backend IA + admin · **Risco:** R3 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE14, BE19, BE13

**Dependências:** [PROD-01](PROD-01.md), [PROD-10](PROD-10.md), [PROD-04](PROD-04.md)

**Decisões:** D05

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `modules/secretary-adapter/src`
- `packages/database/src/schema.ts`
- `packages/database/supabase/migrations`
- `modules/admin/src`
- `apps/desk-web/src/pages/Admin.tsx`
- `apps/desk-api/src/__tests__/production/prod-13.test.ts`

**Locks:** schema-migrations

## Critérios de aceite

- **PROD-13-AC1** — priorInvocations vem de contador persistente atômico por conversa; chamadas concorrentes e restart não superam orçamento. Conteúdo/histórico/timeout/retry já existentes permanecem.
- **PROD-13-AC2** — D05 define ferramentas efetivamente habilitadas. Conectar dispatcher existente ao enforcement se habilitadas, com validação ator/recurso, deny desconhecida e aprovação por revisor autorizado; caso não habilitadas, desabilitar exposição e corrigir claim sem anunciar fluxo ativo.
- **PROD-13-AC3** — Aprovação vinculada a payload original canônico/ação/recurso/escopo, nunca hash de versão truncada/sanitizada; CAS para decidir/consumir, expiração/revogação e uso único conforme contrato.
- **PROD-13-AC4** — Negativos budget, duplo approve/use, replay, args phone/email/conteúdo diferentes e ação proibida; registros sanitizados recursivamente e respostas tardias não vencem handoff humano.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: Ambiente sintético próprio; URL/identidade antes de imports. Testes reais usam runner validado e artifacts fora do histórico..

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-13.test.ts
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
