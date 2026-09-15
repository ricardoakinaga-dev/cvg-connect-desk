# PROD-08 — Eliminar conversas órfãs e duplicatas no primeiro inbound

**Observação da auditoria:** 19/19 testes R3 passam em segmento próprio r3-prod08-20260914-a2; nenhum dado de produção foi usado e a revisão independente permanece pendente.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** Sem achado individual; completar/revalidar os aceites.

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-08 / estado recebido PLANNED

**Estado:** REVIEW · **Prioridade:** P0 · **Marco:** M1 · **Estimativa relativa:** 3

**Dono funcional:** Backend persistência · **Risco:** R3 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE08, BE17, DT01

**Dependências:** [PROD-07](PROD-07.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `modules/chat/src/infrastructure/repositories/inbound-atomic.repository.ts`
- `modules/chat/src/infrastructure/repositories/message.repository.ts`
- `modules/chat/src/infrastructure/repositories/inbound-contact.repository.ts`
- `modules/chat/src/__tests__`
- `apps/desk-api/src/__tests__/production/prod-08.test.ts`

**Locks:** Aplicar exclusão por arquivos e recursos do ambiente.

## Critérios de aceite

- **PROD-08-AC1** — Duas primeiras mensagens duplicadas concorrentes com/sem externalConversationId produzem uma conversa lógica, mensagem e intenções esperadas; transação perdedora não comita conversa/outbox órfãos.
- **PROD-08-AC2** — Mensagem+estado+contato/vínculo+histórico+outbox participam do executor correto; falha em cada escrita rollback completo e hints somente pós-commit.
- **PROD-08-AC3** — Paginação/keyset preserva ordem total em timestamps empatados e inserts concorrentes; busca/detalhe continuam autorizados.
- **PROD-08-AC4** — Identificar órfãos legados por dry-run e oferecer reconciliação idempotente com aprovação para mutação irreversível, sem apagar silenciosamente mensagens.

## Verificação proposta

Estado: **PASS**. Ambiente: Candidato R3 com PostgreSQL/Redis locais isolados; executores de produção, concorrência, rollback, paginação, autorização e reconciliação cobertos; nenhum dado de produção..

19/19 testes locais passam sem skip; evidência de provider externo não é alegada.

```bash
CVG_PROGRAM_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3 CVG_RUNTIME_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3/evidencias/prod-08/r3-prod08-20260914-a2/runtime CVG_EVIDENCE_SEGMENT=r3-prod08-20260914-a2 AAA_RUN_ID=r3-prod08-20260914-a2 AAA_WORKER_INDEX=16 AAA_ATTEMPT=2 pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-08.test.ts
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

19/19 testes R3 passam com PostgreSQL/Redis isolados, cobrindo concorrência, atomicidade por escrita, rollback, hints pós-commit, keyset e reconciliação de órfãos; revisão do integrador ainda é necessária.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-08/r3-prod08-20260914-a2/manifest.json, evidencias/prod-08/r3-prod08-20260914-a2/prod-08-evidence.json, evidencias/prod-08/r3-prod08-20260914-a2/runtime/environment/isolated-env.json, evidencias/prod-08/r3-prod08-20260914-a2/prod-08.test.log

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
