# PROD-06 — Harmonizar schema e timezone; preparar evolução relacional

**Observação da auditoria:** Correção de timezone/migração e proposta D03 entregues; fresh+upgrade/timezone do candidato integrado ainda requerem prova.

**Tratamento:** COMPLETE_AND_VERIFY · PARTIAL_REQUIRES_VERIFICATION

**Achados:** Sem achado individual; completar/revalidar os aceites.

**Origem:** CVG-PRODUCTION-20260913 / PROD-06 / estado recebido IMPLEMENTED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M1 · **Estimativa relativa:** 3

**Dono funcional:** Backend dados · **Risco:** R3 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** DT01, BE03, BE08, BE10, BE20

**Dependências:** [PROD-01](PROD-01.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `packages/database/src/schema.ts`
- `packages/database/src/check-migrations.ts`
- `packages/database/supabase/migrations`
- `modules/tutors/src`
- `modules/patients/src`
- `apps/desk-api/src/__tests__/production/prod-06.test.ts`

**Locks:** schema-migrations

## Critérios de aceite

- **PROD-06-AC1** — Confrontar schema completo com ledger/DDL e corrigir timestamp vs timestamptz de sessão; testar valores históricos em UTC e America/Sao_Paulo preservando instantes e deadlines.
- **PROD-06-AC2** — FKs/índices/uniques e deletes têm invariantes verificáveis; upgrade de cópia populada e migration fresh independentes, drift/checksum divergente bloqueia readiness.
- **PROD-06-AC3** — Inventariar tutor_patients N:N documentado versus patient.tutorId e preparar proposta D03 com impacto, migração e compatibilidade. Este aceite termina na proposta; decisão e implementação relacional pertencem a PROD-25 e não bloqueiam as correções independentes de sessão/webhook.
- **PROD-06-AC4** — Numerar novas migrations pelo integrador; ensaiar interrupção/restart e roll-forward, sem editar SQL já aplicado nem deletar dados para testes.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: Ambiente sintético próprio; URL/identidade antes de imports. Testes reais usam runner validado e artifacts fora do histórico..

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-06.test.ts
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
