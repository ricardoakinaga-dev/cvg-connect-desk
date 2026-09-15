# PROD-16 — Relatório de execução (fechar escopo de privacidade e política por cópia)

**Tarefa:** PROD-16 (BE20/BE05/BE19/OP08 · G05 · C08 · D02) · **Data:** 2026-09-13 · **Executor:** agente backend privacidade
**Candidato:** `754f9ba` + worktree de produção (alterações preexistentes preservadas)
**Estado:** execução concluída com provas reais; **não** declaro DONE (fechamento é do integrador); **D02 continua OPEN**.

---

## 1. Problema confirmado e repro do ANTES

O candidato (prefixo do worktree) tinha as duas falhas do achado BK13:

1. **requestId global vazando** — `erasure-operation.ts:489` (`findOperationByRequestId`)
   buscava por `request_id` sem ator/contato/escopo e o resultado era devolvido
   direto (`:527`) como `deduplicated: true`; a consulta/retomada no controller
   (`:185`, `:209`) não revalidavam escopo.
2. **resume sem escopo** — `resumeContactErasure(operationId)` (`:651`) e
   `getPrivacyOperation(operationId)` (`:736`) não recebiam ator/escopo; qualquer
   `admin:write`/`admin:read` alcançava operação de contato de outro setor.

**Repro real (exit 0):** `repro-antes.ts` roda no runner isolado, usa a semântica
pré-delta versionada em `before/` (cópias com sha256 registrado) contra PostgreSQL
isolado e confronta com o serviço NOVO na mesma base. Saída em `repro-antes.json`:

```json
{
  "oldCode": {
    "findOperationByRequestId": { "line": 489 },
    "globalDedupReturn": { "line": 527 },
    "resumeSignature": { "line": 651, "text": "export async function resumeContactErasure(operationId: string)..." },
    "getSignature": { "line": 736 },
    "controllerResumeCall": { "line": 209, "text": "const result = await resumeContactErasure(request.params.id);" }
  },
  "oldRequestIdLeak": {
    "callerScope": ["setor B"],
    "requestedContact": "<contato do setor B>",
    "globalLookupReturnedOperationOf": "<contato do setor A>",
    "returnedOtherContactReport": true
  },
  "oldResumeWithoutScope": {
    "lookupByIdReturnedOperation": true,
    "oldFunctionAcceptedOnly": "operationId",
    "scopeCheck": false
  },
  "newBehavior": {
    "incompatibleRequestId": { "ok": false, "reason": "conflict" },
    "outOfScopeRead": { "ok": false, "reason": "out_of_scope" }
  }
}
```

Artefatos: `repro-antes.ts`, `repro-antes.json`, `before/erasure-operation.ts`
(sha256 `ff5fb6fa…`), `before/privacy.controller.ts` (sha256 `5340e2a9…`) e
`../integration-runs/prod16-repro/{runner-summary.json,runner-output.log}`.

---

## 2. Delta implementado

| Arquivo | Mudança |
|---|---|
| `modules/privacy/src/application/privacy-access.ts` (novo) | Resolve o escopo ATUAL por membership/global admin (ausência de setores nunca é admin); a decisão de ação continua no `requirePermission` das rotas, que usa a fonte efetiva de permissões (D01/PROD-04). |
| `modules/privacy/src/application/privacy-audit.ts` (novo) | `recordPrivacyRefusal`: auditoria de recusas (`lgpd.*.refused`) com ator, `reasonCode`, correlação e escopo — sem PII. |
| `modules/privacy/src/application/contact-graph.ts` | `sameScope` (idempotência) e `intersectScopes` (retomada nunca amplia alcance). |
| `modules/privacy/src/application/erasure-operation.ts` | `RunErasureInput.confirmIrreversible`; `requestId` vinculado a ator+contato+modo+escopo (409 `conflict` sem relatório alheio, inclusive na corrida 23505); `resumeContactErasure({operationId, actor, scope, confirmIrreversible})` com interseção de escopo e `resumedBy`; `cancelPrivacyOperation` (marcador `CANCELLED`); `getPrivacyOperation(id, {actorId, scope})`; `residualScan` no relatório. |
| `modules/privacy/src/application/scoped-export.ts` | `mediaAssets` no pacote autorizado (metadados + presença de bytes via `media-copy-port`); fora do escopo segue omitido. |
| `modules/privacy/src/application/data-inventory.ts` | Seção por cópia ganha `exportable` e `contactInScope`; mídia expõe `retentionUntil`; política por cópia inventariada. |
| `modules/privacy/src/application/residual-scan.ts` | `scanResidualIdentifierList` (identificadores capturados antes da operação). |
| `modules/privacy/src/presentation/http/privacy.controller.ts` | Export integral só com escopo global (403 `FULL_EXPORT_DENIED` para setorial; `scope=authorized` segue); GET/resume/cancel de operação com escopo atual → 404 sem vazamento; erasure aceita `confirmIrreversible` e mapeia 404/409 (`REQUEST_ID_CONFLICT`, `IRREVERSIBLE_CONFIRMATION_REQUIRED`, `OPERATION_NOT_RESUMABLE`); `/anonymize` revalidado no escopo; recusas auditadas. |
| `apps/desk-api/src/__tests__/production/prod-16.test.ts` (novo) | Suíte de aceite (9 casos) HTTP+PG isolado. |
| `apps/desk-api/src/__tests__/aaa-17.integration.test.ts` | Só o call-site de `resumeContactErasure` adaptado à nova assinatura. |
| `docs/LGPD_DATA_SUBJECT_REQUESTS.md` | Estado/inventário PROD-16 (sem ratificar política): endpoints, escopo/recusas e tabela implementado × BLOCKED. |

**Sem alteração de schema/migrations** (lock `schema-migrations` não usado);
`packages/auth` não foi tocado; sem mudanças em notes/alerts (fora do escopo de escrita).

---

## 3. Critérios de aceite

### AC1 — ator+escopo atuais em toda consulta/listagem/retomada/cancelamento — **PASS (HTTP+PG real)**
- Operação criada pelo setor A: `GET /privacy/operations/:id` do setor B → **404**; `resume` e `cancel` do setor B → **404**, sem corpo com id/telefone. Controle no escopo (Manager A, Admin) → 200.
- `requestId` reusado por outro ator/contato → **409 `REQUEST_ID_CONFLICT`**; repetição idêntica → `deduplicated: true` com o mesmo `operationId`; 1 linha em `privacy_operations` por requestId; corpo do 409 não contém o relatório alheio.
- **Revogação no meio**: operação com falha injetada (checkpoint 4) e membership removido; `resume` do ator revogado → **404** e a PII continua no contato (nenhum passo novo). Segunda identidade no mesmo setor retoma do checkpoint (`resumedFrom=4`, 10 passos, `resumedBy` da sessão) e conclui parcial.
- **Cancelamento** no escopo: 200 com `cancelled: true`, idempotente; `resume` posterior → **409 `OPERATION_NOT_RESUMABLE`**.
- Permissão pela fonte efetiva: Manager (só `admin:read`) → **403** no erasure.

### AC2 — exportação/eliminação por cópia/escopo, dry-run, confirmação e auditoria — **PASS (HTTP+PG real)**
- Export integral para ator setorial → **403 `FULL_EXPORT_DENIED`**; `scope=authorized` omite conversas/mensagens/notas/mídia do outro setor (`omitted`, sem `B SEGREDO`); contato exclusivo do outro setor → **404**. Admin global mantém integral (compatibilidade, 2 conversas).
- `mediaAssets` do escopo listados com `objectPresent` via **media-copy-port** (`true` para objeto existente); eliminação HTTP de contato fora do escopo → 404, **zero** bytes apagados e ativo do outro setor intacto.
- Execução setorial em contato compartilhado: setor B permanece com PII e `residualScan.hits > 0` (sobra declarada), `partial: true`, `fullErasureClaimed: false`.
- **Irreversível**: com política de exclusão de bytes, erasure sem `confirmIrreversible` → **409 `IRREVERSIBLE_CONFIRMATION_REQUIRED`**, nenhum byte apagado, nenhuma operação criada e recusa auditada; `dry-run` → `mutatedCopies: 0` e bytes intactos; com confirmação → byte apagado (`storageStatus: DELETED`), auditoria com `"irreversibleConfirmed":true`.
- `residualScan` e checkpoints: execução completa → `checkpoint: 10`, 10 passos, resíduo `backup/external-backup-not-rewritten`, `residualScan.hits: 0`, varredura de reidentificação vazia.

### AC3 — política por cópia inventariada e D02 OPEN — **PASS (inventário/dry-run)**
- `GET /inventory`: 10 seções (`contact`, `tutor-link`, `conversation`, `message`, `note`, `outbox`, `dlq`, `media-asset`, `audit`, `backup`), cada uma com finalidade, retenção proposta, `exportable`, `pseudonymizable`, `deletable`, `backup` e `pendingDecision: D02`; `backup.observed: false`; mídia com `retentionUntil`; resposta sem PII; `policy.mode: dry-run`, `irreversibleDeleteAllowed: false`.
- Execução irreversível só existe com configuração explícita + confirmação; D02 permanece OPEN (registrado abaixo).

### AC4 — testes negativos reais HTTP+PG no runner isolado — **PASS**
- 9 casos no runner isolado (`prod16`, worker 25, `cvg_aaa_prod16_w25`), incluindo todos os negativos pedidos: outro setor não vê operação; escopo revogado bloqueia retomada; export não inclui dado fora do escopo; residual scan detecta sobra; mídia fora do escopo negada; requestId divergente sem relatório alheio.
- Recusas ficam em `audit_logs` (`lgpd.*.refused`) sem PII; execução/retomada auditam ator, correlação, escopo e confirmação.

---

## 4. Comandos e resultados

| # | Comando | Exit |
|---|---|---|
| 1 | `pnpm --filter @cvg/privacy typecheck` | 0 |
| 2 | `pnpm --filter @cvg/privacy lint` | 0 |
| 3 | `pnpm --filter @cvg/desk-api exec tsc --noEmit` | 0 |
| 4 | `cd apps/desk-api && npx eslint src/__tests__/production/prod-16.test.ts` | 0 |
| 5 | `node scripts/production/run-integration-isolated.mjs --run-id prod16 --worker 25 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-16.test.ts` | **0** — 9/9 |
| 5b | Mesmo comando da #5 com `AAA_PG_PORT=58832 AAA_REDIS_PORT=58842` (re-execução final com o código final) | **0** — 9/9 |
| 6 | `node scripts/production/run-integration-isolated.mjs --run-id prod16unit --worker 25 -- pnpm --filter @cvg/privacy exec vitest run src/__tests__/data-subject-service.test.ts` | **0** — 4/4 |
| 7 | `node scripts/production/run-integration-isolated.mjs --run-id prod16-repro --worker 25 -- pnpm --filter @cvg/privacy exec tsx ../../docs/producao-2026-09-13/evidencias/prod-16/repro-antes.ts` | **0** — vazamento antigo reproduzido + bloqueio novo |
| 7b | Mesmo comando da #7 com `AAA_PG_PORT=58832 AAA_REDIS_PORT=58842` (re-execução final com o código final) | **0** — idem #7 |

**Nota ambiental (#5b/#7b):** entre 14:04 e 14:06 outros agentes ocuparam as portas
padrão do worker 25 (`58932`/`56930`); as re-execuções finais usaram portas
dedicadas (`58832`/`58842`) mantendo `--worker 25` e o banco `cvg_aaa_prod16_w25`.
O primeiro par de execuções padrão (#5/#7) já havia passado; a re-execução
confirma o código final. Nenhuma porta foi tomada de outro processo.

Evidência bruta: `prod-16-evidence.json`, `repro-antes.json` e
`../integration-runs/{prod16,prod16unit,prod16-repro}/runner-summary.json` +
`runner-output.log`. Teardown `dropDatabase` sempre pelo `--run-id`; nenhum banco do host.

---

## 5. BLOCKED de D02 (com dono)

| Bloqueio | Dono | Fronteira |
|---|---|---|
| Eliminação definitiva de dados/bytes em produção | **Responsável pelos dados** (+ operação) | Só com ratificação D02; hoje a execução real exige configuração explícita (`PRIVACY_OPERATION_MODE=execute` + listas aprovadas + `confirmIrreversible`). |
| Liberação/reescrita de backups e dados restaurados | **Responsável pelos dados + operação (DR)** | Reaplicação da política após restore é manual e o backup é sempre residual declarado; D02/D06 definem o procedimento. |
| Prazos de retenção ratificados (mídia/eventos/IA/logs) | **Responsável pelos dados** | Inventário propõe; sem ratificação o código não elimina por prazo. |

Nada disso foi convertido em PASS. O que não depende de ratificação (inventário,
dry-run, escopo, redaction, residual scan, confirmação e auditoria) avançou.

---

## 6. Riscos

- **Mudança de compatibilidade do export**: Manager (que tem `admin:read` no
  catálogo) antes obtinha export integral; agora recebe 403 e precisa de
  `scope=authorized`. Documentado em `LGPD_DATA_SUBJECT_REQUESTS.md`; consumidores
  administrativos devem ser avisados no release.
- **Contato compartilhado**: escopo é por conversa; contato com conversa no
  setor do ator permanece visível (correto), mas operações sobre ele podem ser
  consultadas por ambos os setores — o `resumedBy`/escopo efetivo ficam na trilha.
- **Cancelamento sem status novo**: usa `failed` + `last_error=CANCELLED` e
  `report.cancelled` (schema fora do escopo de escrita). Monitoração que trate
  `failed` como retry deve checar o marcador.
- **Custo do `residualScan`** por operação: leituras extras nas cópias do
  contato; sem PII no retorno e proporcional ao escopo.
- **`exists` por mídia no export**: latência do port no storage; falha do port
  vira `objectPresent: null` (nunca inventa presença).
- **Assinatura alterada** de `resumeContactErasure`/`getPrivacyOperation` para
  callers externos ao módulo (o único consumidor real é o controller).

---

## 7. Recuperação / rollback

- Delta restrito a `modules/privacy/**` + suíte + docs; **sem schema/migrations**
  e sem `packages/auth`. Rollback = reverter os arquivos do módulo; a versão
  pré-delta está em `before/` com sha256 registrado para comparação.
- Operações já persistidas continuam legíveis: escopo/relatório armazenados não
  mudaram de formato (campos novos são aditivos: `residualScan`, `resumedBy`,
  `cancelled`).
- Execuções usam apenas o banco isolado do run (worker 25, porta 58932) e o
  teardown por `runId`; nada no banco do host foi tocado. Em ensaio real,
  preferir expand/contract e reaplicar retenção após restore (PROD-37).

## 8. Limitações honestas

- **aaa-17 não reexecutado** nesta execução: a suíte exige o fixture histórico
  `aaa-20260912-a17` (127.0.0.1:56432 + moto 59010). Apenas o call-site de
  `resumeContactErasure` foi adaptado (typecheck 0) e o comportamento equivalente
  é re-provocado no `prod-16` no run próprio.
- Exclusão de bytes de mídia é provada pela **media-copy-port** (a abstração do
  módulo) com storage de teste em memória; S3/MinIO reais ficam em PROD-14.
- `confirmIrreversible` é gate de aplicação; a ratificação de finalidade/prazo
  (D02) continua externa.
- Autores de notas/alertas a partir da sessão (redação do AC2 do arquivo de
  tarefa) não foram alterados: `modules/notes` e `modules/alerts` estão fora do
  escopo de escrita desta execução.
- Os ACs do arquivo `tasks/PROD-16.md` têm redação mais ampla; este relatório
  segue os AC1–AC4 operacionais do pedido e mapeia: AC1→AC1/AC2 (escopo e
  idempotência), AC2→AC2/AC4 (checkpoint/duas identidades/recusas), AC3→AC3
  (inventário/dry-run/BLOCKED), AC4→AC4 (export/residual/auditoria).

## 9. Evidências

- `prod-16-evidence.json` — 9 casos com status HTTP, contagens e auditoria.
- `repro-antes.ts` / `repro-antes.json` / `before/*.ts` — repro do antes e hashes.
- `../integration-runs/prod16/`, `../integration-runs/prod16unit/`,
  `../integration-runs/prod16-repro/` — runner-summary e logs completos.
- `docs/LGPD_DATA_SUBJECT_REQUESTS.md` — estado/inventário (D02 OPEN).
