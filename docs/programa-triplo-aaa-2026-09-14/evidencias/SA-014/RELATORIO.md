# SA-014 — Relatório de evidência (contrato de mensagem durável e reconciliação)

- **Tarefa:** SA-014 (requisitos B05/B20; gates G02/G03, fechamento G12)
- **Builder:** builder-b (backend/mensageria)
- **Candidato:** `754f9bad+worktree#710396fa`
- **Data:** 2026-09-15
- **Veredito da execução nova:** PASS 8/8 (exit 0) em PostgreSQL 16 + Redis isolados (runner SA-003)
- **Defeitos de produto encontrados:** nenhum (não houve parada de edição; ver “Histórico de tentativas”)

## 1. Arquivo novo

`apps/desk-api/src/__tests__/sa-014-message-contract.integration.test.ts`
sha256 `76f277fb891c4ee24e744616433d4d628b6cfa7fdadb94efabdf09706aee5703`

Nenhum outro arquivo de código/produto, schema, migração, lockfile, fixture ou BACKLOG.json foi alterado.
A única falha de execução intermediária foi um bug de **teardown do próprio teste** (FK
`conversations_contact_id_fkey`), corrigido com sweep das conversas inbound por prefixo — sem tocar código de produto.

## 2. Comandos e resultados

### 2.1 Execução funcional (isolada)

```bash
node scripts/production/run-integration-isolated.mjs --run-id sa014-b1-20260915-r3 --worker 45 --skip-seed -- \
  pnpm --filter @cvg/desk-api exec vitest run src/__tests__/sa-014-message-contract.integration.test.ts
```

- `db:types` exit 0 · `db:migrate` exit 0 · comando exit 0
- **Test Files 1 passed (1) · Tests 8 passed (8)** · duração ~2,8 s
- Ambiente: `cvg_aaa_sa014_b1_20260915_r3_w45` (PG `127.0.0.1:60932`, Redis `127.0.0.1:57130`), dropDatabase no cleanup
- Artefatos: `runner-summary.json` (sha256 `67c1434c…`), `runner-output.log` (sha256 `0199e435…`)

### 2.2 Gates estáticos

```bash
pnpm --filter @cvg/desk-api typecheck
pnpm --filter @cvg/desk-api exec eslint src/__tests__/sa-014-message-contract.integration.test.ts
```

Ambos sem erros/warnings no arquivo novo.

## 3. Mapa AC → prova

| AC | Prova NOVA (executada aqui) | Cobertura existente CITADA (não duplicada) |
|---|---|---|
| **AC1** inbound concorrente / assinatura renovada / receipt completed / payload divergente | “converge para a primeira mensagem…”: mesmo `externalMessageId` com conteúdo divergente, `eventId` novo e HMAC/timestamp renovados → 200 idempotente, **1 conversa, 1 mensagem (conteúdo original), 1 `conversation.created`, 1 `message.persisted`, unread=1, 0 órfãs** | `production/prod-08.test.ts` AC1a/AC1c/AC1d (primeiro inbound concorrente, sem órfãos); `production/prod-07.test.ts` AC1 (retry/recuperação com efeito único — a assinatura renovada NÃO é asserida nesse teste; ver §4.5); `production/prod-11.test.ts` AC2 (receipt completed resolve 1×; duplicado/late failure não regridem); `modules/chat/src/__tests__/aaa-08-atomicity.test.ts` (corrida de duplicata: 1 vencedor) |
| **AC2** intenção antes do efeito; key/hash com escopo; desconhecido→reconciliação | “falha no INSERT do mapping (trigger)…” → rollback total (0/0/0) e **provider com 0 chamadas**; replay cria 1/1/1; “hash canônico…” → metadados reordenados deduplicam e conteúdo divergente ⇒ `IDEMPOTENCY_KEY_CONFLICT`; “aceite desconhecido…” → listado em `listOutboundIntentsForReconciliation`, retry deduplicado sem reenvio | `production/prod-11.test.ts` AC1/AC2 (escopo ator+conversa+payload por HTTP real, 409, TTL, callback 1×); `aaa-12.integration.test.ts` (HTTP: 1 mensagem/1 delivery/1 evento/1 envio sob concorrência; unknown fora da lista de pendências; falha de outbox com 0 chamadas ao provider) |
| **AC3** crash/falha antes/depois do commit e do aceite | “falha no commit APÓS o aceite do provider…” → aceite externo preservado (1 chamada) com estado local **não-terminal** (pending/pending); retry não reenvia; receipt resolve para sent/delivered **uma vez**; duplicado no-op; 1/1/1 | `production/prod-11.test.ts` AC3 (SIGKILL real do processo filho entre envio e callback); `production/prod-10.test.ts` AC2 (worker: crash antes da invocação e replay pós-efeito); `production/prod-08.test.ts` AC2 (falha por ponto de escrita inbound, rollback total); `aaa-08-atomicity.test.ts`; `aaa-12.integration.test.ts` |
| **AC4** receipts e mensagens fora de ordem | (a) “receipts em ordem inversa…” → `delivered` não regride (`deliveredAt`/`attempt_count` estáveis; `sent`/`read` tardios no-op); (b) “receipt ANTES da mensagem…” → no-op seguro `{skipped, reason:'message_not_found'}` sem linhas, intent listável para reconciliação e convergência na reentrega (duplicado no-op; referência órfã nunca “gruda”); (c) “inbounds fora de ordem…” → 2 mensagens 1× cada com `sentAt` próprios, unread=2, retry renovado não duplica | `production/prod-11.test.ts` AC2 (receipt duplicado, late failure, corrida callback×envio convergindo para um estado) |

## 4. Tratamento DEFINIDO — receipt que chega antes da mensagem

1. **Sem efeito e sem linha nova**: `/gateway/receipt` responde `200 {skipped:true, reason:'message_not_found'}`; nenhum registro é criado e nenhuma referência é “reservada”.
2. **Fallback bounded**: se o provider não reentregar o receipt, a intenção persiste não-terminal e é visível em `listOutboundIntentsForReconciliation` / `resolveOutboundIntentExplicitly` (reconciliação explícita; nunca reenvio cego).
3. **Convergência**: reentrega do receipt após a persistência resolve a intenção **uma única vez**; duplicatas são no-op.
4. Não existe buffer durável de receipts órfãos — decisão registrada nesta evidência, não defeito.
5. **Retry do MESMO `event_id` (correção pós-crítica)**: a rota `/gateway/receipt` não completa o claim de replay (`completeWebhookClaim` só é chamado no webhook inbound); enquanto o claim estiver `in_progress`, a reentrega com o mesmo `event_id` responde **409 `event_in_progress`** e não aplica efeito. A convergência provada nos testes usa `event_id` NOVO; a recuperação para o mesmo id depende do fallback bounded da reconciliação (item 2) quando o claim expira. Este comportamento está registrado como limitação de contrato, não como sucesso silencioso.

## 5. Limitações e o que NÃO foi verificado

- **Fault injection** é feita por trigger no banco + reexecução do caso de uso no mesmo processo (sem SIGKILL nesta suíte). O crash real de processo é citado de `prod-11` AC3 / `prod-10` AC2. O teste novo isola “commit local” de “efeito externo”, que é o limite que faltava.
- O provider outbound é a **porta** com ledger de chamadas (não o sandbox HTTP); o caminho HTTP outbound é citado de `prod-11`/`aaa-12`.
- As suítes citadas foram **inspecionadas** (asserções lidas no candidato) e **não reexecutadas** nesta rodada; a regressão integrada do candidato deve executá-las.
- **Não verificado**: reexecução de prod-07/08/10/11 e aaa-08/12; SIGKILL do cenário pós-aceite; revisão sem autoria (`reviewer: pending`).
- `--skip-seed`: a suíte não depende de seed (cria as próprias conversas); migrações foram aplicadas pelo runner.

## 6. Histórico de tentativas

| Attempt | Run-id | Resultado |
|---|---|---|
| 1 | `sa014-b1-20260915` | `PG_PORT_BUSY` (porta 60932 ocupada por processo alheio no instante) — ambiente, sem execução |
| 2 | `sa014-b1-20260915-r2` | 8/8 testes PASS, suíte FAIL no teardown (FK de contato: limpeza do próprio teste) — corrigido |
| 3 | `sa014-b1-20260915-r3` | **PASS 8/8, exit 0**, cleanup completo (worker 45) |
| 4 | `sa014-b1-20260915-r4` | **PASS 8/8, exit 0** (worker 46, confirmação de reprodutibilidade) |

## 7. Artefatos

- `apps/desk-api/src/__tests__/sa-014-message-contract.integration.test.ts` (novo)
- `evidencias/SA-014/evidence.jsonl` (append-only)
- `evidencias/SA-014/RELATORIO.md` (este)
- `evidencias/SA-014/runner-summary.json` (resumo do runner copiado — execução 1)
- `evidencias/SA-014/runner-output.log` (saída do vitest/runner — execução 1)
- `evidencias/SA-014/runner-summary-run2.json` / `runner-output-run2.log` (execução de confirmação)
