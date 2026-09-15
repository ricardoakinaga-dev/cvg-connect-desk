# PROD-13 — Relatório de execução

**Cartão:** PROD-13 — Fechar budget durável e workflow seguro de ferramentas IA (AC1–AC4)
**Itens auditados:** BE13 · BE14 · BE19 · **Contratos:** C08 · **Gates:** G05/G10
**Estado do cartão:** IMPLEMENTED (não DONE — integrador registra aceites/identidade antes de fechar)
**Decisões:** D05 permanece **OPEN**. O avanço implementado é exatamente o permitido sem ratificação: budget durável, fail-closed, deny-default e o workflow de aprovação **desabilitado por flag segura** (`SECRETARY_AI_TOOLS_ENABLED=false`). Nenhum efeito de ferramenta foi habilitado.

**Candidato:** HEAD `754f9badac46278e77d21de91c58eedb15e80581` + worktree (delta **não commitado**). O worktree já continha o delta não commitado do PROD-10 (base para `secretary_invocations`) e de outras frentes; esta tarefa **não** editou `packages/auth`, `packages/media`, `modules/privacy`, repositórios de outbound nem webhook.

Ambiente de prova (harness AAA, nunca o banco do host): PostgreSQL 16 + Redis isolados por run (`marker.runId` conferido, `cvg_aaa_*`), migrate+seed reais e teardown por runId.

| Run | Worker | PostgreSQL | Banco | Redis | Exit |
|---|---|---:|---|---:|---:|
| `prod13-repro2` (repro antes) | 39 | 127.0.0.1:60332 | `cvg_aaa_prod13_repro2_w39` | 57070 | 0 |
| `prod13-verif1` (1ª rodada AC; asserts 11/11, teardown do pool — corrigido) | 39 | 127.0.0.1:60332 | `cvg_aaa_prod13_verif1_w39` | 57070 | 1 |
| `prod13-verif2/3/4` (suíte AC, 3 rodadas finais) | 39 | 127.0.0.1:60332 | `cvg_aaa_prod13_verif{2,3,4}_w39` | 57070 | 0 / 0 / 0 |
| `prod13-reg-secretary` / `prod13-reg-secretary2` | 40 / 46 | 127.0.0.1:60432 / 61032 | `…reg_secretary_w40` / `…reg_secretary2_w46` | 57080 / 57140 | 0 / 0 |
| `prod13-reg-chat` / `prod13-reg-chat-full` | 41 / 45 | 127.0.0.1:60532 / 60932 | `…reg_chat_w41` / `…reg_chat_full_w45` | 57090 / 57130 | 0 / 0 |
| `prod13-reg-worker` | 42 | 127.0.0.1:60632 | `cvg_aaa_prod13_reg_worker_w42` | 57100 | 0 |
| `prod13-reg-prod10` | 43 | 127.0.0.1:60732 | `cvg_aaa_prod13_reg_prod10_w43` | 57110 | 0 |
| `prod13-dbcheck` (migração fresh) | 44 | 127.0.0.1:60832 | `cvg_aaa_prod13_dbcheck_w44` | 57120 | 0 |

> Uma tentativa do `prod13-reg-secretary2` na porta padrão do worker 40 falhou por **contenção externa** (outra frente ativa ocupou a porta Redis 57080 no intervalo); reexecutada no worker 46, exit 0. Nenhuma falha de código foi mascarada.

---

## 1. Problema reproduzido (antes do delta)

Script `repro-antes.ts` executou o CÓDIGO REAL (`invokeSecretary`, `ai-tools`) contra PostgreSQL isolado + sandbox HTTP da Secretary:
`repro-antes.json` / `logs/repro-antes-runner.log` (run `prod13-repro2`, exit 0, veredito **DEFECT_REPRODUCED — 4/4**).

| Defeito | Evidência antes | Consequência |
|---|---|---|
| A — budget ignorado | 3 invocações persistidas, limite 1, **1 chamada externa** (`resultado: allow`) | `priorInvocations: 0` fixo ⇒ `maxInvocationsPerConversation` nunca dispara no fluxo real |
| B — hash colide | telefones diferentes ⇒ **mesmo hash** `33b59985…2229` | aprovação do payload A autorizaria payload B (hash sobre args sanitizados) |
| C — sem uso único | 1ª e 2ª chamadas = **allow** após 1 approve | aprovação reutilizável indefinidamente (sem CAS/consumo) |
| D — registry inerte | nenhum arquivo de produção importa/usa `invokeAITool` | enforcement sem chamador produtivo |

```json
{
  "A_budget_ignorado":            { "priorInvocationsPersistidas": 3, "limiteConfigurado": 1, "chamadasSecretary": 1, "resultado": "allow", "defect": true },
  "B_hash_colide_apos_sanitizacao": { "mesmosArgsSanitizados": true, "defect": true },
  "C_aprovacao_sem_uso_unico":    { "primeiraChamada": "allow", "segundaChamada": "allow", "defect": true },
  "D_registry_sem_chamador":      { "arquivosDeProducaoComInvokeAITool": [], "defect": true },
  "verdict": "DEFECT_REPRODUCED", "defectCount": 4
}
```

---

## 2. Delta (arquivos desta tarefa)

| Arquivo | Mudança |
|---|---|
| `packages/database/supabase/migrations/0028_ai_budget_and_approval_hardening.sql` (novo, 36 linhas) | `secretary_invocations.status` aceita `denied`; `ai_action_approvals.status` aceita `CONSUMED` + colunas `consumed_at`/`scope_sanitized`. Expand-only (alarga CHECKs, colunas com default). |
| `packages/database/supabase/migrations/meta/_journal.json` | Entrada `0028` (idx 28). |
| `packages/database/src/schema.ts` | `aiApprovalStatusEnum` +`CONSUMED`; `consumedAt`/`scopeSanitized` em `aiActionApprovals`. |
| `modules/secretary-adapter/src/application/ai-policy.ts` | `AIBudgetExhaustedError` (403, permanente); `reasonCode` na policy; `sanitizeAIArgs` **recursivo** (profundidade 8, sem PII aninhada). |
| `modules/secretary-adapter/src/application/ai-tools.ts` (reescrito, 432) | `canonicalizeAIArgs`/`hashToolArgs(tool, args, scope)` sobre payload **original canônico**; flag `SECRETARY_AI_TOOLS_ENABLED` (default off); `AIToolDeniedError` 403 `AI_POLICY_DENIED`; aprovação com validade, CAS de decisão, **uso único** (`CONSUMED`), reabertura explícita e autorizador de revisor fail-closed. |
| `modules/secretary-adapter/src/infrastructure/repositories/secretary-invocation.repository.ts` | `beginSecretaryInvocation` com admissão atômica sob `pg_advisory_xact_lock` por conversa + `maxInvocations`; terminal `denied` durável; `countConversationInvocations` (exclui `denied`/própria invocação). |
| `modules/secretary-adapter/src/application/use-cases/invoke-secretary.use-case.ts` | `priorInvocations` do contador durável; indisponibilidade do store ⇒ deny 403 (fail-closed) auditado. |
| `modules/secretary-adapter/src/index.ts` | Exporta `ai-policy`/`ai-tools` (consumidor worker/chat e testes). |
| `modules/chat/src/application/use-cases/execute-inbound-secretary.use-case.ts` | Passa o limite efetivo; converte `AIBudgetExhaustedError` em estado `denied` terminal (ACK, sem DLQ ruidosa e sem resposta). |
| `modules/secretary-adapter/src/__tests__/ai-policy.test.ts` (+68) | Limite exato, erro tipado, sanitização recursiva. |
| `modules/secretary-adapter/src/__tests__/ai-tools.test.ts` (reescrito, 270) | Flag/deny-default, hash original, expiração, duplo decide, uso único, revisor, escopo sanitizado. |
| `modules/secretary-adapter/src/__tests__/ai-bypass.test.ts` | Liga a flag no teste de pedido de aprovação (unknown continua negado). |
| `modules/secretary-adapter/src/__tests__/invoke-secretary.integration.test.ts` | Conversation ids UUID (contador PG) + caso fail-closed de budget indisponível. |
| `apps/desk-api/src/__tests__/production/prod-13.test.ts` (novo, 751) | 11 casos PG real do harness AAA. |
| `docs/producao-2026-09-13/evidencias/prod-13/**` | este relatório, `repro-antes.ts/json`, logs, `prod-13-evidence.json`. |

Eventos versionados e contratos C04/C05 existentes **não** foram alterados; a mudança é aditiva (novo terminal de estado e novas colunas/flag).

---

## 3. Aceites com prova

Suíte final `prod13-verif2`/`prod13-verif3`/`prod13-verif4` (3 rodadas limpas; `verif4` após o último endurecimento de fail-closed na criação de aprovação) — **11/11 PASS, exit 0** em todas:
`logs/vitest-prod-13-verif{2,3,4}.log` + `prod-13-evidence.json`.

### AC1 — budget durável, concorrente e fail-closed

| Caso | Prova | Resultado |
|---|---|---|
| Contador durável cresce por conversa | 3 invocações admitidas + retry da mesma chave (attempt 2) ⇒ `countConversationInvocations=4`, outra conversa = 0; retry **não** consumiu de novo | PASS |
| Limite exato nega com erro tipado | limite 2: 2 admitidas, 3ª lança `AIBudgetExhaustedError` (403, `AI_BUDGET_EXHAUSTED`, permanente); linha `denied` durável sem PII; retry da mesma mensagem continua negado | PASS |
| Concorrência (2 simultâneas, limite 1) | `Promise.allSettled` ⇒ **1 admitida / 1 negada**; 1 linha admitida, 1 `denied` | PASS |
| Restart não reseta | nova conexão PG enxerga 1 admitida; nova tentativa negada (fonte persistente) | PASS |
| Fluxo do worker (PROD-10) | `executeInboundSecretaryInvocation` com limite 1 ⇒ `status: denied`, linha `denied`, **0** chamadas à IA, **0** outbound | PASS |
| Gate de policy com `priorInvocations` durável | 2 invocações persistidas + limite 2 ⇒ `invokeSecretary` nega 403 antes de chamar a IA; com limite 3 permite e chama **1×** | PASS |
| Budget indisponível não permite bypass | conversationId inválido ⇒ erro de contagem PG ⇒ 403 `AI_POLICY_DENIED` (`budget store unavailable`), **0** chamadas | PASS |

### AC2 — ferramentas com deny-default, hash original e revisor

| Caso | Prova | Resultado |
|---|---|---|
| D05 OPEN ⇒ superfície desabilitada | flag ausente: `contact.lookup/note.create/contact.update/contact.delete` ⇒ deny `AI_TOOLS_DISABLED` com `statusCode: 403`, `code: AI_POLICY_DENIED`; `decideApproval` lança 403 `AI_POLICY_DENIED` | PASS |
| Aprovação vinculada ao payload ORIGINAL + escopo | `hashToolArgs` distingue telefones (`…9999` ≠ `…8888`), é estável à ordem das chaves e vinculado ao `scope`; payload B **não** herda approve de A; `scope_sanitized` sem PII | PASS |
| Revisor autorizado | autorizador injetado decide; revisor não autorizado ⇒ 403 e aprovação continua `PENDING` (fail-closed); sem autorizador configurado ⇒ deny | PASS |
| Validade/expiração | aprovação vencida não vira `APPROVED`; uso nega `AI_APPROVAL_EXPIRED` | PASS |

### AC3 — degradação, auditoria sem PII, limite exato

| Caso | Prova | Resultado |
|---|---|---|
| Timeout tipado preservado | sandbox lento + timeout 50ms ⇒ `SECRETARY_TIMEOUT`; timeout/retry do cliente inalterados | PASS |
| Auditoria sem PII | decisões em memória (`getAIDecisions`) e `secretary_invocations.denied`/`ai_action_approvals` não contêm conteúdo nem telefone; sanitização recursiva | PASS |
| Limite exato nega | `priorInvocations === limite` nega (`INVOCATION_BUDGET`); admissão atômica nega na enésima+1 | PASS |

### AC4 — negativos e handoff

| Caso | Prova | Resultado |
|---|---|---|
| Payload diferente / replay / duplo uso | args B com approve de A ⇒ novo pedido (não allow); replay do payload A ⇒ `AI_APPROVAL_CONSUMED`; 2º approve ⇒ `null`; expirada ⇒ deny | PASS |
| Telefone/e-mail/conteúdo distintos | hashes canônicos distintos; `sanitizeAIArgs` recursivo redige `[PHONE]`/`[EMAIL]`/`[OMITTED]` | PASS |
| Ação proibida | `classifyAITool` FORBIDDEN e `evaluateAIPolicy` negam (`ACTION_FORBIDDEN`/`TOOL_FORBIDDEN`) | PASS |
| Resposta tardia não vence handoff humano | regressão **PROD-10 7/7 PASS** (superseded/handler humano cancelam resposta tardia) — o delta não toca esse caminho | PASS |

---

## 4. Comandos e exit codes

Todos via runner isolado (PG/Redis próprios; teardown por runId). Logs copiados em `logs/`.

```bash
# Repro ANTES — exit 0; veredito DEFECT_REPRODUCED (A/B/C/D)
node scripts/production/run-integration-isolated.mjs --run-id prod13-repro2 --worker 39 \
  -- pnpm exec tsx docs/producao-2026-09-13/evidencias/prod-13/repro-antes.ts

# Suíte AC (3 rodadas limpas) — exit 0; 11/11 PASS em cada
node scripts/production/run-integration-isolated.mjs --run-id prod13-verif2 --worker 39 \
  -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-13.test.ts
node scripts/production/run-integration-isolated.mjs --run-id prod13-verif3 --worker 39 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-13.test.ts
node scripts/production/run-integration-isolated.mjs --run-id prod13-verif4 --worker 39 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-13.test.ts

# Regressões — todas exit 0
node scripts/production/run-integration-isolated.mjs --run-id prod13-reg-secretary --worker 40 -- pnpm --filter @cvg/secretary-adapter test   # 48/48
node scripts/production/run-integration-isolated.mjs --run-id prod13-reg-secretary2 --worker 46 -- pnpm --filter @cvg/secretary-adapter test  # 48/48 (pós-último hunk)
node scripts/production/run-integration-isolated.mjs --run-id prod13-reg-chat-full --worker 45 -- pnpm --filter @cvg/chat exec vitest run --exclude '**/aaa-08-atomicity.test.ts'  # 34/34
node scripts/production/run-integration-isolated.mjs --run-id prod13-reg-worker --worker 42 -- pnpm --filter @cvg/message-worker test      # 13/13
node scripts/production/run-integration-isolated.mjs --run-id prod13-reg-prod10 --worker 43 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-10.test.ts  # 7/7
node scripts/production/run-integration-isolated.mjs --run-id prod13-dbcheck --worker 44 -- pnpm --filter @cvg/database db:check          # OK: 41 tabelas fresh

# Estático (exit 0)
pnpm --filter @cvg/secretary-adapter typecheck && pnpm --filter @cvg/chat typecheck \
  && pnpm --filter @cvg/database typecheck && pnpm --filter @cvg/desk-api typecheck
pnpm --filter @cvg/secretary-adapter lint && pnpm --filter @cvg/chat lint
pnpm --filter @cvg/desk-api exec eslint src/__tests__/production/prod-13.test.ts
pnpm --filter @cvg/secretary-adapter exec vitest run src/__tests__/ai-policy.test.ts   # 9/9, sem PG (job unit)
```

> Rodada de desenvolvimento `prod13-verif1` (11/11 asserts PASS) terminou com exit 1 por um **erro não tratado no teardown do pool compartilhado** do `@cvg/database` (mesmo padrão já resolvido no PROD-10). Corrigido com `getPool().end()` no `afterAll`; as rodadas finais `verif2/verif3` são limpas. Nenhuma falha foi mascarada por skip.

---

## 5. D05 permanece OPEN — superfície desabilitada

- Flag **`SECRETARY_AI_TOOLS_ENABLED`** (default `false`): com a flag desligada, `invokeAITool` nega **toda** ferramenta (403 `AI_POLICY_DENIED`) e `requestHumanApproval`/`decideApproval` lançam `AIToolDeniedError` (403). Nada de efeito real é habilitado.
- **Nenhum chamador produtivo** de `invokeAITool`/`decideApproval` existe hoje (repro D) e **nenhuma rota HTTP/UI** os expõe; a superfície permanece inerte até ratificação.
- Revisor autorizado é um **port injetável** com default deny (D01 OPEN — catálogo de papéis não ratificado).
- Quando D05 for ratificada: ligar a flag e injetar o autorizador de revisor; o endurecimento (hash original, escopo, expiração, CAS, uso único, sanitização) já está implementado e provado.
- Nenhuma ratificação foi inventada; os comentários de código foram corrigidos para não anunciar fluxo ativo.

---

## 6. Riscos e limitações (honestos)

1. **Semântica de consumo do budget**: invocações admitidas contam mesmo quando o efeito é `skipped` (handler humano/superseded) ou falha antes da chamada externa — conservador, sem refund. Retry/crash da MESMA mensagem não consome de novo (chave estável).
2. **Retenção**: purgar `secretary_invocations` (BE12/PROD-26) resetaria o budget por conversa; a política de retenção deve preservar a contagem ou migrá-la para um ledger próprio.
3. **Negação terminal por mensagem**: o evento é ACKado com `status: denied`; replay re-nega. Para reprocessar, o operador precisa elevar o limite e/ou administrar a linha `denied` (operação destrutiva sujeita a autorização).
4. **Observabilidade**: negações aparecem em `secretary_invocations` (durável) e no relatório do handler, mas **não há métrica/alert dedicado** (C09/PROD-31/32) nem evento novo de outbox (contrato C04 preservado de propósito).
5. **Reabertura de aprovação** (`requestHumanApproval` em REJECTED/EXPIRED/CONSUMED) reusa a MESMA linha via CAS; o histórico da decisão anterior não fica em coluna separada (a decisão foi auditada no momento; sem tabela de histórico).
6. **Escopo opcional**: chamadores que não passam `scope` vinculam apenas `tool+args` (compatível com o contrato anterior); o recomendado é sempre passar ator/recurso.
7. **Limite dinâmico**: `SECRETARY_MAX_INVOCATIONS_PER_CONVERSATION` é lido a cada chamada; elevar o valor aumenta o teto imediatamente (mudança de configuração, não efeito colateral).
8. **Prova sintética**: sandbox HTTP local, sem provider real, browser ou operador; PROD-40 inspeciona independentemente. O worktree contém deltas de outras frentes; a identidade do candidato final é do integrador.

---

## 7. Recuperação e rollback

- **Orçamento esgotado (diagnóstico)**: `SELECT conversation_id, invocation_key, status, error_code FROM secretary_invocations WHERE conversation_id = '<id>' ORDER BY created_at;` (`denied` = bloqueios). Elevar o teto é a via suportada; reprocessar mensagens `denied` exige decisão explícita.
- **Aprovação pendente/expirada**: revisor autorizado decide; se expirada, `requestHumanApproval` reabre (CAS) com nova validade.
- **Rollback de código**: reverter somente os hunks desta tarefa nos arquivos do §2 (o worktree tem hunks do PROD-10/outras frentes nos mesmos arquivos; **não** usar `git checkout` cego).
- **Rollback de schema (0028)**: antes de restaurar as constraints antigas, remover/reclassificar linhas `denied` (ex.: `DELETE FROM secretary_invocations WHERE status='denied'`), então `ALTER TABLE ... DROP CONSTRAINT`/restaurar CHECK anterior e `DROP COLUMN consumed_at, scope_sanitized`. Nenhuma linha pré-existente é alterada pela 0028.
- **Teardown de testes**: apenas por runId no runner isolado (`cvg_aaa_prod13_*`); nunca apagar banco pré-existente.

**Sem skip/TODO/`.only`** nos arquivos desta tarefa (verificado por grep). O fechamento DONE depende do integrador conferir identidade do candidato, revisão e os aceites; PROD-40 inspeciona independentemente.
