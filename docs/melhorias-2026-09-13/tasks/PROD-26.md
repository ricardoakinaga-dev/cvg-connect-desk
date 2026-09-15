# PROD-26 — Completar administração de permissões e auditoria

**Observação da auditoria:** Aceites deste cartão ainda não encerrados; código existente deve ser revalidado e complementado, sem presumir ausência pela marca PLANNED.

**Tratamento:** IMPLEMENT_AND_VERIFY · REMAINING_SCOPE

**Achados:** FE13

**Origem:** CVG-PRODUCTION-20260913 / PROD-26 / estado recebido PLANNED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M2 · **Estimativa relativa:** 8

**Dono funcional:** Frontend admin + backend acesso · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** UI13, BE04, BE05, BE12

**Dependências:** [PROD-04](PROD-04.md), [PROD-13](PROD-13.md), [PROD-16](PROD-16.md), [PROD-17](PROD-17.md)

**Decisões:** D01, D05

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `apps/desk-web/src/pages/Admin.tsx`
- `apps/desk-web/src/pages/Audit.tsx`
- `apps/desk-web/src/pages/Settings.tsx`
- `apps/desk-web/src/lib/api.ts`
- `modules/admin/src`
- `modules/audit/src`
- `packages/auth/src`
- `e2e/production/prod-26.spec.ts`

**Locks:** auth-contract, web-contract-inbox

## Critérios de aceite

- **PROD-26-AC1** — Editor de permissões por papel e vínculo usuário-papel/setor aplica a fonte efetiva D01; remover permissão tem efeito em HTTP/WS/sessão ativa. Prevenir autoelevação e perda do último admin conforme regra congelada.
- **PROD-26-AC2** — Usuários/papéis/filas/times com membros, DLQ e perfil/senha têm caminhos completos com validação, confirmação, erro/retry e nomes humanos; sem controles placebo.
- **PROD-26-AC3** — Auditoria consulta/filter/pagina ação/recurso/ator/tempo e registra alterações administrativas, sem PII indevida; perfis sem permissão não veem dados nem endpoints.
- **PROD-26-AC4** — Quando D05 habilitar ferramentas, revisor autorizado consegue aprovar/rejeitar com payload claro/minimizado; sem D05 não expor aprovação fictícia.
- **PROD-26-AC5** — Gestão de vínculo usuário↔papel e memberships/setores tem endpoint efetivo, autorização, auditoria e revogação; descobrir e implementar contrato ausente em coordenação com PROD-04/26.

## Verificação proposta

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm exec playwright test e2e/production/prod-26.spec.ts --config playwright.production.config.ts
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
