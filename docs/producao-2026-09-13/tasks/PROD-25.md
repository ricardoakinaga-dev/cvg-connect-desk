# PROD-25 — Consolidar contatos, tutores e pacientes

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M2 · **Estimativa relativa:** 11

**Dono funcional:** Frontend hospitalar + dados · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** UI12, DT01, UI05

**Dependências:** [PROD-06](PROD-06.md), [PROD-22](PROD-22.md), [PROD-24](PROD-24.md)

**Decisões:** D03

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `apps/desk-web/src/pages/Contacts.tsx`
- `apps/desk-web/src/pages/Tutors.tsx`
- `apps/desk-web/src/pages/Patients.tsx`
- `apps/desk-web/src/lib/api.ts`
- `modules/contacts/src`
- `modules/tutors/src`
- `modules/patients/src`
- `e2e/production/prod-25.spec.ts`
- `packages/database/src/schema.ts`
- `packages/database/supabase/migrations`

**Locks:** schema-migrations, web-contract-inbox

## Critérios de aceite

- **PROD-25-AC1** — CRUD/detalhe/iniciar conversa funcionam com vínculo tutor-paciente ratificado, names/phone normalizados e busca de recursos autorizados; dedup mantém dado canônico.
- **PROD-25-AC2** — Ficha reúne conversas/notas/tarefas/labels/grupos autorizados com paginação e links; contato sem setor segue exceção documentada, não vira acesso global a conversas.
- **PROD-25-AC3** — Formulários modal preservam dados e foco após falha; salvar/editar/desvincular atualiza Inbox/contexto e não remove histórico por cascade indevido.
- **PROD-25-AC4** — Fixtures de múltiplas conversas/tutores/pacientes e duas identidades comprovam integridade/privacidade e compatibilidade do legado.
- **PROD-25-AC5** — Executar D03 ratificada: padrão N:N com expansão, backfill idempotente, constraints/índices, compatibilidade de leitores antigos, API e UI; provar fresh/upgrade com múltiplos tutores. Manter 1:N exige alteração explícita de escopo e documentos, sem afirmar N:N entregue. Nenhuma decisão aberta fecha este aceite.

## Verificação proposta

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Especificação de regressão a criar/adaptar após descoberta. Cobrir os aceites aplicáveis com casos positivos e negativos; exit 0 isolado não comprova o aceite integrado.

```bash
pnpm exec playwright test e2e/production/prod-25.spec.ts --config playwright.production.config.ts
```

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Revalidar os achados e predecessores desta tarefa no candidato atual, antes de editar.

**Sinal de conclusão da ação:** Mapa achado→caminho real e reprodução/limite atual registrados no retorno.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
