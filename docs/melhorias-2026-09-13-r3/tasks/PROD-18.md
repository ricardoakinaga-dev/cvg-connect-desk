# PROD-18 — Completar APIs operacionais transacionais e trilha de auditoria

**Observação da auditoria:** Suíte R3 de PROD-18 executada em segmento próprio r3-prod18-20260914-a1; 18/18 passou com PostgreSQL/Redis isolados, migrations e triggers reais. expected* segue opcional/ausente na UI; revisão independente e gates externos permanecem pendentes.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** BE-A06

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-18 / estado recebido PLANNED

**Estado:** REVIEW · **Prioridade:** P0 · **Marco:** M2 · **Estimativa relativa:** 5

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

Estado: **PASS**. Ambiente: Candidato R3 com PostgreSQL/Redis isolados, migrations aplicadas no banco do run e HTTP via app.inject do app de produção; triggers reais para falhas transacionais; sem dados de produção..

18 testes passam sem skip; operações transacionais, auditoria/outbox, autorização, CAS/idempotência, rollback, concorrência e DTOs/paginação permanecem observáveis; versão ponta a ponta esperada* e revisão independente continuam pendentes.

```bash
CVG_PROGRAM_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3 CVG_RUNTIME_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3/evidencias/prod-18/r3-prod18-20260914-a1/runtime CVG_EVIDENCE_SEGMENT=r3-prod18-20260914-a1 AAA_RUN_ID=r3-prod18-20260914-a1 AAA_WORKER_INDEX=42 AAA_ATTEMPT=1 pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-18.test.ts
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Suíte R3 executada com PG/Redis isolados, migrations e triggers reais; 18/18 testes passaram cobrindo transações/rollback, auditoria/outbox, autorização, CAS/idempotência, concorrência e DTOs. expected* segue opcional/ausente na UI; revisão independente permanece pendente.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-18/r3-prod18-20260914-a1/manifest.json, evidencias/prod-18/r3-prod18-20260914-a1/prod-18.test.log, evidencias/prod-18/r3-prod18-20260914-a1/evidence-matrix.json, evidencias/prod-18/r3-prod18-20260914-a1/logs/db-migrate.log, evidencias/prod-18/r3-prod18-20260914-a1/runtime/environment/isolated-env.json

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
