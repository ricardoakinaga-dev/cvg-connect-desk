# PROD-08 — Relatório de execução

**Cartão:** PROD-08 — Eliminar conversas órfãs e duplicatas no primeiro inbound (AC1–AC4)
**Itens auditados:** BE08 · BE17 · DT01 · **Contratos:** C03/C07 (G03) · **Estado do cartão:** IMPLEMENTED (não DONE)
**Candidato:** HEAD `754f9badac46278e77d21de91c58eedb15e80581`, worktree preservada (o delta é
não rastreado; nenhum arquivo de `packages/auth`, `webhook-guard/anti-replay`, `apps/realtime-service`
ou migration foi tocado — a fronteira do PROD-05 e do lock `schema-migrations` foi respeitada).

Ambiente de prova (harness AAA, nunca o banco do host): PostgreSQL 16 + Redis isolados por run
(`marker.runId` conferido nos dois sentidos, `cvg_aaa_*`), migrate+seed reais e teardown com
`stopServices+dropDatabase`.

| Run | Worker | PostgreSQL | Banco | Redis |
|---|---|---:|---|---:|
| `prod08` (suíte AC) | 16 | 127.0.0.1:58032 | `cvg_aaa_prod08_w16` | 56840 |
| `prod08-repro` (repro antes) | 17 | 127.0.0.1:58132 | `cvg_aaa_prod08_repro_w17` | 56850 |
| `prod08-repro2` (contraprova) | 17 | 127.0.0.1:58132 | `cvg_aaa_prod08_repro2_w17` | 56850 |

`marker.sourceRevision = 754f9bad…` presente em todos; teardown removeu banco e parou serviços
(nos runs de teste o teardown do próprio `afterAll` precede o do runner — daí `stopped:false` no
resumo do runner).

---

## 1. Problema reproduzido (antes do delta)

Script `repro-antes.ts` (usa o **código real** de `persistInboundAtomically` no estado anterior;
roda no runner isolado) e saída integral em `repro-antes.json` + `logs/repro-antes.log`.

**Cenário A — mesma primeira mensagem concorrente, sem `externalConversationId`** (com `contactPhone`):
dois `persistInboundAtomically` simultâneos; o upsert do contato serializa as transações, a
perdedora detecta a duplicata da mensagem por `onConflictDoNothing` e **retorna do callback**
(`return` de `db.transaction` = COMMIT). Resultado observado:

```json
"scenarioA": {
  "winnerConversationId": "5ff5d513-…", "loserConversationId": "a7522e37-…",
  "messages": 1, "orphanConversations": 1,
  "orphanConversationCreatedEvents": 1, "orphanStatusHistory": 1, "winnerUnread": 1
}
```

⇒ **conversa órfã commitada** (sem nenhuma mensagem) + `conversation.created` no outbox +
histórico `open`, além da mensagem única na conversa da vencedora. É exatamente o BE08
(“caso duplicado retorna sem rollback das conversas já criadas”).

**Cenário B — mesma primeira mensagem concorrente, com o mesmo `externalConversationId`**
(8 rodadas): as duas transações leem “conversa inexistente” e disputam o índice único
`idx_conversations_external`; a perdedora recebe violação de unicidade (não é 2xx idempotente):

```json
"scenarioB": { "iterations": 8, "loserErrors": 8, "bothOk": 0,
               "maxConversations": 1, "maxMessages": 1,
               "sampleError": "Failed query: insert into \"conversations\" …" }
```

Veredito do script no estado anterior: `DEFECT_REPRODUCED` (arquivo `repro-antes.json`).

---

## 2. Delta

| Arquivo | Mudança |
|---|---|
| `modules/chat/src/infrastructure/repositories/inbound-atomic.repository.ts` (não rastreado; 154→415 linhas) | (a) **advisory lock transacional por `externalConversationId`** antes de qualquer escrita — o segundo inbound da mesma conversa espera o commit do primeiro e a encontra, em vez de colidir no índice único; (b) `DuplicateInboundRaceError` lançado quando `createIdempotent` retorna duplicata, abortando a transação perdedora (**rollback completo** de conversa/histórico/contato/outbox) e `resolveCommittedDuplicate` relendo o vencedor fora da transação (2xx idempotente, sem efeito novo); (c) **AC4**: `findOrphanConversations` (dry-run read-only, critério `conversation_without_messages`, escopo opcional por prefixo) e `reconcileOrphanConversations` (arquiva com aprovação explícita, idempotente, nunca apaga mensagem/outbox). Nenhum DELETE no arquivo. |
| `modules/chat/src/infrastructure/repositories/message.repository.ts` | **sem mudança** — `createIdempotent` já aceitava o `tx` e já retornava `{message, isDuplicate}`; o defeito estava em quem tratava o retorno. |
| `modules/chat/src/infrastructure/repositories/inbound-contact.repository.ts` | **sem mudança** — o upsert do contato já participava do `tx`; o rollback por ponto foi provado por trigger (AC2). |
| `apps/desk-api/src/__tests__/production/prod-08.test.ts` (novo, 1115 linhas) | 19 testes PG real: AC1a–AC1e (corridas com/sem id externo, mensagens diferentes na mesma conversa, 6 rodadas, use-case), AC2 por ponto de escrita (7 triggers + attach contato + barreira de hint), AC3a–AC3c (ordem total com `updatedAt` empatado, inserts concorrentes, escopo globalAdmin), AC4a–AC4b (dry-run e reconciliação). |
| `docs/producao-2026-09-13/evidencias/prod-08/**` (novo) | este relatório, `PROCEDIMENTO-RECUPERACAO.md`, `repro-antes.ts`, JSONs de repro/reconciliação, `prod-08-evidence.json`, logs e summaries, `rollback/`. |

## 3. Aceites com prova

Suíte final (exit 0, **19/19 em duas rodadas consecutivas**): `logs/vitest-prod-08.log` e
`logs/vitest-prod-08-rodada2.log`; casos em `prod-08-evidence.json`.

### AC1 — corrida de duplicatas (UMA conversa lógica, UMA mensagem, outbox esperado, rollback da perdedora)

| Caso | Prova | Resultado |
|---|---|---|
| AC1a COM `externalConversationId` | 2 chamadas simultâneas: mesmo `messageId`/`conversationId`; ambos `ok`; `conversations=1` (unread=1); `messages=1`; `conversation.created=1`; `message.persisted=1`; órfãos=0; 1 hint pós-commit | PASS |
| AC1b SEM id externo | 2 chamadas simultâneas com `contactPhone` único: mesmo par mensagem/conversa; contato com **1** conversa; `orphanConversationsForPhone = 0`; intenções 1× | PASS |
| AC1c 6 rodadas alternando com/sem id | invariantes repetidas (ids únicos por rodada, órfãos 0) | PASS |
| AC1d use-case real | `receiveInboundMessage` concorrente: mesma conversa lógica, exatamente um `isNewConversation=true`, 1 mensagem, 0 órfãos | PASS |
| AC1e mensagens DIFERENTES na mesma conversa externa nova | lock serializa a resolução: as duas persistem na MESMA conversa (1 conversa, 2 mensagens, unread=2, `conversation.created=1`, `message.persisted=2`, órfãos 0) — o cenário que, sem lock, produzia colisão 23505 na perdedora (repro B) | PASS |

Contraprova no PG isolado com o **mesmo** `repro-antes.ts` após o delta (`repro-depois.json`,
`logs/repro-depois.log`): `orphanConversations=0`, `loserErrors=0`, `bothOk=8`,
veredito `NO_DEFECT_OBSERVED`.

### AC2 — mesmo executor transacional e hints só após commit

Falha injetada por **trigger real** em CADA ponto, com contagem global das 5 tabelas
(`contacts`, `conversations`, `conversation_status_history`, `messages`, `outbox_events`) antes/depois:
`after == before` (nenhuma linha commitada), mensagem/conversa/eventos ausentes, nenhum hint novo;
retry com o portão desarmado grava exatamente 1 de cada (status history=1, contato=1, unread=1).

| Ponto de escrita | Teste | Resultado |
|---|---|---|
| `contacts` (insert do contato inbound) | AC2-contacts | PASS |
| `conversations` (create) | AC2-conversations | PASS |
| `conversation_status_history` | AC2-conversation_status_history | PASS |
| `outbox:conversation.created` | AC2-outbox:conversation.created | PASS |
| `messages` | AC2-messages | PASS |
| `outbox:message.persisted` | AC2-outbox:message.persisted | PASS |
| `conversation_state` (`markInboundUnread`/`attachContact`) | AC2-conversation_state | PASS |
| vínculo contato↔conversa existente | AC2-attach-contact: falha no UPDATE de vínculo → `contact_id` continua NULL, contato não existe, mensagem/evento ausentes; retry vincula e persiste | PASS |
| hint só pós-commit | AC2-hint-pos-commit: transação **aberta** (barreira após as escritas, antes do commit) → terceiro não enxerga mensagem/evento e `hints` não recebe nada; após liberar, o hint chega com o MESMO `event_id` do outbox durável | PASS |

Observação: o `outbox_events` foi contado “por tabela” e a asserção de intenções usa
`aggregate_id` do vencedor (sem falso positivo por payload).

### AC3 — keyset/ordem total, concorrência e autorização

| Caso | Prova | Resultado |
|---|---|---|
| AC3a ordem total | 9 conversas com o MESMO `updatedAt` (grupos de unread/handler): paginação limit=2 percorre tudo, sem pular/duplicar, na ordem esperada `(unread, handler, updated_at, id)` DESC — o id é o desempate total | PASS |
| AC3b inserts concorrentes | 6 originais empatados + 2 inserts **durante** a travessia das páginas (mesmo timestamp): união sem repetição e todos os originais presentes | PASS |
| AC3c escopo/autorização | membro de 1 setor vê só o setor; ator **sem memberships** e `globalAdmin` ausente vê 0 (deny-by-default); `globalAdmin: true` explícito vê todos; cursor de outro ator/escopo é recusado (`decodeConversationCursor` → null) e cursor malformado → null | PASS |

Nenhuma mudança de código foi necessária para AC3: o repository endurecido (BE17/D01) já
possuía ordem total com desempate por `id`, predicado `ROW(...) < ROW(...)` e deny-by-default;
o delta AC3 é a prova executada (antes era NOT_RUN). A rota `GET /conversations` (permissão +
escopo) permanece coberta pela regressão de PROD-04.

### AC4 — órfãos legados: dry-run + reconciliação com aprovação

**Critério exato (documentado no código e aqui):** candidata = conversa com
`NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)` — **sem nenhuma
mensagem**. É a forma residual do defeito BE08: a perdedora commitava a conversa (com
histórico `open` e `conversation.created`) enquanto a única mensagem ficava na conversa da
vencedora. Conversa com ≥1 mensagem **nunca** é candidata (mesmo sem contato); o outbox é log
imutável e não é mutado; o padrão `activeOnly` restringe mutações a conversas ativas.

```sql
-- dry-run (candidatos; inclui external_conversation_id NULL, o formato clássico sem id externo)
SELECT c.id, c.external_conversation_id, c.external_channel_id, c.status::text, c.status_v2::text,
       c.is_active, (c.contact_id IS NOT NULL) AS has_contact,
       EXISTS (SELECT 1 FROM outbox_events o
                WHERE o.event_type='conversation.created' AND o.aggregate_id=c.id::text) AS has_created_intent,
       EXISTS (SELECT 1 FROM conversation_status_history h WHERE h.conversation_id=c.id) AS has_status_history,
       c.created_at, c.updated_at
  FROM conversations c
 WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
 ORDER BY c.created_at ASC, c.id ASC;
```

| Caso | Prova | Resultado |
|---|---|---|
| AC4a dry-run | órfã (sem msg) detectada com flags; conversa **com** mensagem e conversa **sem contato mas com** mensagem não são candidatas; órfã com `external_conversation_id NULL` detectada; `is_active`/`updated_at` inalterados | PASS |
| AC4b reconciliação | sem `approve` → `applied:false/approval_required` e nada muda; com `approve:true` → arquiva (`is_active=false`, `status=archived`, `status_v2=arquivado`, `closed_at`) + histórico; **mensagem preservada** e conversa saudável intocada; 2ª rodada → `no_candidates` (idempotente) | PASS |

Uso operacional (função desligada por padrão; nenhuma rota HTTP foi criada — fora do escopo):

```ts
const report   = await findOrphanConversations({ limit: 500 });            // read-only
const result   = await reconcileOrphanConversations({ approve: true, actor: '<uuid>' }); // mutação aprovada
```

## 4. Comandos e resultados

| Comando (runner isolado) | Exit | Resultado |
|---|---:|---|
| `… --run-id prod08-repro --worker 17 -- pnpm exec tsx …/repro-antes.ts` | **0** | `DEFECT_REPRODUCED` (órfã=1, perdedor falha 8/8) |
| `… --run-id prod08 --worker 16 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-08.test.ts` | **0** | **19 passed (19)** |
| `… --run-id prod08b --worker 16 -- … prod-08.test.ts` (rodada 2) | **0** | **19 passed (19)** — estabilidade sob carga concorrente |
| `… --run-id prod08-repro2 --worker 17 -- pnpm exec tsx …/repro-antes.ts` | **0** | `NO_DEFECT_OBSERVED` (órfã=0, bothOk=8) |
| `… --run-id prod08-chat --worker 16 -- pnpm --filter @cvg/chat exec vitest run` | 1 | 5/6 arquivos PASS: **34 passed, 8 skipped**; `aaa-08-atomicity.test.ts` aborta no guard de ambiente fixo (porta 56432) — ver limitações |
| `AAA_PG_PORT=56432 AAA_REDIS_PORT=56685 … --run-id aaa-20260912-a8 --worker 0 -- … aaa-08-atomicity.test.ts` | 1 | `PG_PORT_BUSY`: 56432 pertence ao run `aaa-20260912` de outro executor (não derrubado) |
| `… --run-id prod08-regressao07 --worker 16 -- … prod-07.test.ts` | 1* | **9 passed (9)**; exit 1 apenas por erro não tratado de socket Redis no teardown do PROD-07 |
| `… --run-id prod08-regressao07b --worker 16 -- … prod-07.test.ts` | 1* | 8 passed / 1 failed: flake no lifecycle do recibo do próprio PROD-07 (`event_in_progress` no retry após falha injetada), não relacionado a este delta |
| `pnpm --filter @cvg/chat typecheck` · `pnpm --filter @cvg/desk-api typecheck` | 0 · 0 | sem erros |
| `pnpm --filter @cvg/chat lint` · `pnpm --filter @cvg/desk-api lint` | 0 · 0 | 0 erros (8 e 5 warnings preexistentes, dentro do teto) |

\* Os exits 1 dos runs de regressão vêm de artefatos do próprio PROD-07/ambiente, não de falha
de teste do inbound: no r1 todos os 9 testes passaram; no r2 um teste do recibo oscilou sob
carga concorrente da máquina. Nenhum teste do caminho inbound regrediu.

## 5. Riscos e limitações

1. **Órfãos legados não reparáveis automaticamente**: o dry-run cobre a forma “sem nenhuma
   mensagem” (a do BE08). Pares legados de conversas **ambas com** mensagens (ex.: duas
   primeiras mensagens distintas criadas em corrida antes do lock) não são mesclados nem
   apagados; exigem decisão manual e o critério documentado não os lista. Nada é deletado.
2. **Reconciliação não é rota**: `reconcileOrphanConversations` é função de biblioteca,
   desligada por padrão (`approve !== true` ⇒ dry-run) e sem chamador produtivo nesta tarefa
   (o escopo não inclui `admin`/controllers). A execução exige código/op e aprovação explícita.
3. **Chave do advisory lock**: `hashtextextended` pode colidir e serializar conversas
   diferentes — custo de throughput, nunca de correção; o lock é `xact` (solta no commit/rollback).
4. **Contato só no perdedor**: sem `externalConversationId`, se apenas a transação perdedora
   trouxe `contactPhone`, o upsert do contato é revertido com ela (exigência de rollback
   completo) e a conversa vencedora segue sem vínculo até o próximo inbound; não há contato
   órfão. Documentado para o integrador.
5. **`aaa-08-atomicity.test.ts`** tem portas/DB fixos do harness histórico (56432 /
   `cvg_aaa_aaa_20260912_a8` / 56685) e não pôde ser reexecutado nesta janela: a porta 56432
   está ocupada por um run `aaa-20260912` de outro executor (não derrubado). Seus invariantes
   (rollback por ponto, corrida de mensagem, hint pós-commit) estão re-provados em
   `prod-08.test.ts` AC1/AC2 com contexto dinâmico.
6. **PROD-07**: a rodada 2 mostrou flake no retry do recibo (`event_in_progress` 409 após
   `failWebhookClaim`), comportamento do próprio PROD-07 sob concorrência; registrar para o
   dono do cartão. Nada aponta para o delta PROD-08 (o caminho do erro é o store de replay,
   antes do negócio).
7. **Sem mudança de schema/migrations**: nenhum número de migration novo; nenhuma coluna,
   índice ou dado alterado. `DT01` permanece como observação de que o rollback de dados não
   tem DDL a desfazer.

## 6. Rollback

- **Código**: restaurar `rollback/inbound-atomic.repository.pre-prod08.ts` sobre
  `modules/chat/src/infrastructure/repositories/inbound-atomic.repository.ts` e remover
  `apps/desk-api/src/__tests__/production/prod-08.test.ts`. Como o arquivo é não rastreado,
  o snapshot funcional em `rollback/` é a baseline (não há `git checkout` para ele).
- **Dados**: nenhum. Nenhuma mutação de reconciliação foi executada contra banco real — a
  suíte AC4 rodou apenas no PG isolado do run, removido no teardown. Reintroduzir o pre-delta
  **recria o defeito BE08**; usar apenas em emergência e rodar o dry-run para mapear órfãos.
- Procedimento detalhado: `PROCEDIMENTO-RECUPERACAO.md`.
