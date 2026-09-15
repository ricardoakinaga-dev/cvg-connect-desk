# PROD-18 — Completar APIs operacionais transacionais e trilha de auditoria

**Estado:** IMPLEMENTED · **Prioridade:** P1 · **Marco:** M2 · **Estimativa relativa:** 8

**Dono funcional:** Backend operação · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** UI05, UI06, UI08, UI10, BE04, BE05, BE11

**Dependências:** [PROD-04](PROD-04.md), [PROD-08](PROD-08.md), [PROD-09](PROD-09.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `modules/chat/src`
- `modules/transfers/src`
- `modules/tasks/src`
- `modules/notes/src`
- `modules/alerts/src`
- `modules/audit/src`
- `packages/messaging-contracts/src`
- `packages/database/supabase/migrations`
- `apps/desk-api/src/__tests__/production/prod-18.test.ts`

**Locks:** schema-migrations

## Critérios de aceite

- **PROD-18-AC1** — Atribuir, mudar estado, handoff, transferir e vincular contexto têm operações públicas existentes reaproveitadas e contratos tipados; origem/destino/assignee/estado validado server-side.
- **PROD-18-AC2** — Estado+vínculos necessários+histórico+outbox/audit atômicos ou reconciliação explícita durável; falha entre updates não deixa Kanban/conversa/contato em setores contraditórios.
- **PROD-18-AC3** — CAS/versionamento impede operador antigo sobrescrever mudança de outro; status transitável e erros409/403/404 documentados; ações repetidas sem efeitos duplicados.
- **PROD-18-AC4** — Matriz de audit cobre mensagens, status/atribuição/handoff/tarefa/nota/admin/ack-resolve de alerta com autor derivado da sessão, resultados e correlação.

## Verificação proposta

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Especificação de regressão a criar/adaptar após descoberta. Cobrir os aceites aplicáveis com casos positivos e negativos; exit 0 isolado não comprova o aceite integrado.

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-18.test.ts
```

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

APIs operacionais transacionais e auditoria implementadas; 18/18 e regressões verdes; revisão independente pendente.

**Sinal de conclusão da ação:** Revisor confirma rollback total, auditoria do ator efetivo e CAS/idempotência concorrente.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-18/RELATORIO.md

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
