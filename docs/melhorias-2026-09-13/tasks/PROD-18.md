# PROD-18 — Completar APIs operacionais transacionais e trilha de auditoria

**Observação da auditoria:** Suíte atual18/18 PG confirma transações, trilha e CAS quando enviado; precondições opcionais permitem escrita sem controle de versão.

**Tratamento:** REPAIR_AND_VERIFY · REWORK

**Achados:** BE-A06

**Origem:** CVG-PRODUCTION-20260913 / PROD-18 / estado recebido IMPLEMENTED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M2 · **Estimativa relativa:** 5

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
- **PROD-18-R2-AC5** — Contrato operacional exige precondição/versionamento ou mecanismo equivalente que rejeita edição antiga; definir compatibilidade de rollout. DTO e web carregam versão íntegra; envio sem versão ou desatualizado recebe erro explícito e não sobrescreve outro operador.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: Ambiente sintético próprio; URL/identidade antes de imports. Testes reais usam runner validado e artifacts fora do histórico..

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-18.test.ts
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
