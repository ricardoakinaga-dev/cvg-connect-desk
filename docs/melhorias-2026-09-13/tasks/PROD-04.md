# PROD-04 — Uniformizar permissão de ação e escopo em HTTP/WS

**Observação da auditoria:** Permissão efetiva e verificações de ação/recurso avançaram; matriz completa HTTP/WS ainda requer prova atual, incluindo privacidade legada.

**Tratamento:** COMPLETE_AND_VERIFY · PARTIAL_REQUIRES_VERIFICATION

**Achados:** BE-A05

**Origem:** CVG-PRODUCTION-20260913 / PROD-04 / estado recebido IMPLEMENTED

**Estado:** PLANNED · **Prioridade:** P0 · **Marco:** M1 · **Estimativa relativa:** 5

**Dono funcional:** Backend segurança · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE04, BE06, BE17, BE20, UI02, UI13

**Dependências:** [PROD-01](PROD-01.md)

**Decisões:** D01

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `packages/auth/src`
- `modules/chat/src/presentation/http`
- `modules/chat/src/infrastructure/repositories/conversation.repository.ts`
- `modules/kanban/src`
- `modules/tutors/src`
- `modules/patients/src`
- `modules/contacts/src`
- `modules/notes/src`
- `modules/tasks/src`
- `modules/alerts/src`
- `modules/admin/src`
- `apps/realtime-service/src/authorization.ts`
- `apps/desk-api/src/__tests__/production/prod-04.test.ts`

**Locks:** auth-contract, realtime-runtime

## Critérios de aceite

- **PROD-04-AC1** — Toda variante GET /conversations exige chat:read antes de consultar; sem role ou membership não há conteúdo/últimas mensagens. Query builder nunca interpreta ausência de setores como admin; papel global explícito. Testar revogação entre checagem e query.
- **PROD-04-AC2** — Kanban mover/atribuir/transferir exige ação+origem+destino autorizados; matriz de endpoints por ID/lista/estatística cobre tutores/pacientes/contatos/tasks/alerts/notes/admin e consumidores WS, respeitando exceções D-AUTHZ existentes.
- **PROD-04-AC3** — Uma fonte efetiva de permissões: papéis/permissions editáveis precisam realmente alterar decisão. Validar admin, usuário sem role, read-only, write, dois setores, recurso sem setor, revogação e IDs adulterados; 403/404 estáveis.
- **PROD-04-AC4** — Subscription e entrega WS validam ação/recurso; revogação corta conteúdo em <=5s no perfil congelado. Não enfraquecer gates HTTP para alinhar com WS; negativos reais por rota e socket.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: Ambiente sintético próprio; URL/identidade antes de imports. Testes reais usam runner validado e artifacts fora do histórico..

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-04.test.ts
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
