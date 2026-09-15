# PROD-14 — Relatório de execução (conectar mídia inbound à quarentena e acesso privado)

**Tarefa:** PROD-14 (BE16/BE15/UI04 · G04 · C06) · **Data:** 2026-09-13 · **Executor:** agente backend mídia
**Candidato:** `754f9ba` + worktree de produção (alterações pré-existentes preservadas)
**Estado:** AC1–AC4 implementados e provados nesta revisão; **não** declaro DONE (fechamento é do integrador)

---

## 1. Problema confirmado e repro do antes

Achado BE16 confirmado no candidato: `processInboundMedia` existia sem chamador produtivo,
`MEDIA_PIPELINE_ENABLED` só constava do compose e a URL de mídia recebida no webhook era
persistida direto em `messages.media_url`, sem asset/quarentena/scan, sendo devolvida verbatim
no DTO (a UI renderizava `img/audio` da URL crua — Inbox.tsx:1163-1175).

Repro do antes com o MESMO writer de produção (`persistInboundAtomically`) e o payload que o
use-case pré-PROD-14 repassava — `docs/producao-2026-09-13/evidencias/prod-14/repro-antes.ts`
(exit 0, PG isolado `prod14-repro`):

```json
{
  "rawUrlPersisted": "http://provider.evil.invalid/raw/payload.png",
  "rawUrlMatchesProvider": true,
  "assetsLinked": 0,
  "scanPerformed": false,
  "dtoBefore": { "mediaUrl": "http://provider.evil.invalid/raw/payload.png", "mediaType": "image" },
  "dtoAfterSanitization": { "mediaUrl": null, "mediaAssetId": null, "mediaState": null }
}
```

Interpretação: a referência crua entrava no banco (0 assets, nenhum scan) e o DTO a devolvia;
com o delta, o DTO sanitiza e a URL só existe server-side no estado de intake até o veredito.

Artefatos: `repro-antes.ts`, `repro-antes.json`, `logs/…` e
`../integration-runs/prod14-repro/{runner-summary.json,runner-output.log}`.

---

## 2. Delta implementado

| Arquivo | Mudança |
|---|---|
| `packages/media/src/index.ts` | `processInboundMedia` produtivo: `fetchRemote` via `safeRemoteFetch` (SSRF/DNS/redirect/limite), magic bytes (`validateMediaBytes`), MIME derivado/allowlist, chave de objeto vinculada `media|quarantine/<conversa>/<mensagem>/…`, sha256 determinístico, asset idempotente por `storage_key`, fail-closed (sem scanner/INFECTED/SCAN_FAILED ⇒ quarentena), `reasonCode` explícito. `resolveDeliverableAsset` nega asset sem vínculo (`asset_unbound`). Exporta o inventário legado. |
| `packages/media/src/repository.ts` | `findByStorageKey` (idempotência de retry). |
| `packages/media/src/legacy.ts` (novo) | **AC4 dry-run READ-ONLY**: `dryRunLegacyMediaMigration` identifica mídias legadas fora do storage controlado (raw `http(s)`/`data:`/outro esquema em `messages.media_url`, `asset://` quebrado/não publicado, `media_assets EXTERNAL`, intake retentável PENDING_SCAN/FAILED), com contagem por tipo, `migrationKey` determinística e zero escrita. |
| `modules/chat/src/application/use-cases/inbound-media-pipeline.ts` | `reasonCode` aditivos `asset_unavailable`/`awaiting_revalidation` e campo server-side `legacyRef` no intake (filtrado do DTO). |
| `modules/chat/src/application/use-cases/legacy-media-migration.ts` (novo) | Plano/migração idempotente por mensagem/URL: reusa `processInboundMedia` (safeRemoteFetch/limites/magic/quarentena/CLEAN+STORED), neutraliza `asset://` quebrado preservando `legacyRef` e a mensagem, mantém pendente/infectado indisponível e revalida via `recoverPendingInboundMedia` (`revalidatePendingLegacyInboundMedia`). |
| `modules/chat/src/application/use-cases/index.ts` | Export do módulo legado. |
| `modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts` | Mídia entra no intake (SSRF/limite/MIME avaliados) e a mensagem é preservada mesmo com mídia rejeitada/falha; `media_url` NUNCA recebe URL crua; mídia-única (sem texto) deixou de ser descartada. |
| `modules/chat/src/presentation/http/media-read.controller.ts` (novo) | `GET /conversations/:conversationId/media/:assetId`: `chat:read` + autorização de conversa, bytes proxiados (sem URL pública), `Cache-Control: private, max-age=<TTL>`, códigos 401/404/409/422/503. |
| `modules/chat/src/presentation/http/message-dto.ts` (novo) | DTO sanitizado: só `asset://` é exposto; `metadata.mediaIntake` (com `sourceUrl`/`legacyRef`) removida; `mediaState`/`mediaReasonCode`/`mediaAssetId` explícitos. |
| `modules/chat/src/presentation/http/outbound.controller.ts` | GET `/conversations/:id/messages` e `lastMessage`/`lastInboundMessage` passam pelo DTO sanitizado. |
| `modules/chat/src/presentation/http/webhook-inbound.controller.ts` | Campos `mediaUrl/mediaType/mediaMimetype/mediaFilename` adicionados ao schema (aditivo; `/webhook/inbound` também alimenta o pipeline). |
| `modules/chat/src/presentation/http/index.ts`, `application/use-cases/index.ts` | Exports. |
| `apps/desk-api/src/app.ts` | Registro de `registerMediaReadController` (2 linhas). |
| `apps/desk-api/src/__tests__/production/prod-14.test.ts` | Suíte de aceite (12 casos) com PG isolado + moto S3 real + clamd real; AC4 insere fixtures legadas sintéticas, prova dry-run sem mutação, migração, idempotência, HTTP e revalidação. |

Sem alteração de schema/migrations (não usei o lock `schema-migrations`), sem tocar
`packages/auth`, `contact-groups` ou `conversation.repository`.

### 2.1 Correções da revisão (F2 — lint do desk-api)

| Local | Correção |
|---|---|
| `prod-14.test.ts:147` | `PDF_BYTES` removido (constante nunca usada; o caso magic usa `PNG_BYTES` declarado como PDF). |
| `prod-14.test.ts:338` | `getMessageByExternal` removido (helper nunca usado). |
| `prod-14.test.ts:829` | `let elapsedMs = 0` → `let elapsedMs: number \| undefined` (o inicializador era sobrescrito em todos os caminhos; assert `toBeLessThan(BLACKHOLE_MS / 2)` mantido). |

Nenhum assert foi afrouxado.

---

## 3. Critérios de aceite (PROD-14)

### AC1 — mídia inbound entra no pipeline, mensagem preservada — **PASS (real)**
- CLEAN: webhook `/gateway/inbound` HMAC → 200; pipeline assíncrono grava
  `media/<conv>/<msg>/<sha>` (moto S3 real), scan ClamAV real CLEAN; `media_url` vira
  `asset://<id>`; quarentena ausente; leitura 200 com bytes idênticos.
- Sem scanner: `PENDING_SCAN` em `quarantine/`, leitura 409 `MEDIA_ASSET_PENDING_SCAN`.
- EICAR (ClamAV real): `INFECTED` em `quarantine/` com bytes preservados, leitura 422
  `MEDIA_ASSET_INFECTED`, `media/` inexistente.
- Timeout (clamd preto): webhook respondeu em **7 ms** com scan de 8000 ms em curso;
  veredito `SCAN_FAILED`, leitura 503 `MEDIA_ASSET_SCAN_FAILED`.
- SSRF (`169.254.169.254`): `REJECTED/unsafe_url`, 0 assets, mensagem preservada (mídia-única).
- Fetch remoto falho (`.invalid`): `FAILED/fetch_failed` com `sourceUrl` server-side e
  `recoverPendingInboundMedia` reenfileira 1 (recuperável).
- Idempotência: replay do pipeline não duplica asset (1 linha).

### AC2 — leitura autenticada/autorizada, asset privado, TTL, limites — **PASS (real)**
- S3 anônimo no objeto: **403**; leitura sem token: **401**; usuário sem vínculo de
  conversa: **404**; asset de outra conversa: **404** genérico (sem revelar
  `WRONG_CONVERSATION`) e sem bytes.
- Bytes proxiados pela rota autorizada (nenhuma URL assinada/`X-Amz-Signature` no corpo),
  `Cache-Control: private, max-age=120` (TTL de `MEDIA_SIGNED_URL_TTL_SECONDS`).
- Limite: `getMediaMaxBytes()=16 MiB`; >16 MiB no pipeline → `media_too_large`; teto menor
  no webhook também bloqueia; PNG declarado PDF → `mime_magic_mismatch`; executável/magic
  cobertos pelo mesmo `validateMediaBytes` do upload.
- Códigos claros: PENDING 409, INFECTED 422, SCAN_FAILED 503, NOT_READY 409.

### AC3 — flag real e DTO sem URL crua — **PASS (real)**
- `MEDIA_PIPELINE_ENABLED=true` no compose é lido de fato; ausente ⇒ habilitado (default
  seguro); `false` ⇒ `PIPELINE_DISABLED`, `media_url=null`, 0 assets, sem URL crua no DTO.
- DTO sanitizado em `/conversations/:id/messages` e na lista de conversas; `sourceUrl`,
  `legacyRef` e data-URL não aparecem em nenhuma resposta HTTP.
- **Lacuna registrada (UI fora do escopo de escrita):** `apps/desk-web` (Inbox) não foi
  alterado; hoje asset `asset://` renderiza apenas chip de anexo (UI04). O endpoint de
  leitura existe para o consumo futuro; nenhum asset não-pronto é entregue como público.

### AC4 — dry-run, migração para storage controlado, quarentena/revalidação — **PASS (real)**

**Dry-run read-only (`packages/media/src/legacy.ts`):** identificação pelas colunas reais
`messages.media_url`/`metadata` e `media_assets` — categorias `raw_http_url`, `data_url`,
`other_url`, `broken_asset`, `external_asset`, `pending_intake` (contagem por tipo +
`migrationKey` determinística por mensagem/URL). Prova de zero mutação: snapshot de
`messages`+`media_assets` antes/depois idêntico (`zeroMutations: true` em
`prod-14-ac4-dry-run.json`; contagens observadas: `raw_http_url=1`, `data_url=2`,
`broken_asset=1`, `external_asset=1`, `pending_intake=2`).

**Migração idempotente (`legacy-media-migration.ts`):** cada candidato passa por
`processInboundMedia` (mesmo caminho produtivo: `safeRemoteFetch`+limites, magic bytes,
quarentena, scan real e só CLEAN+STORED publicável). Resultado dos fixtures sintéticos:
- **1 asset controlado publicado**: `media/<conv>/<msg>/<msg>-<sha16>` CLEAN+STORED,
  `media_url=asset://<id>`, leitura HTTP **200** com bytes idênticos;
- **1 INFECTED bloqueado**: quarentena com bytes, `media_url` neutralizada, leitura **422**
  `MEDIA_ASSET_INFECTED`, objeto anônimo no S3 **403** e sem cópia em `media/`;
- **1 pendente** (URL `https://legacy.prod14.invalid/...`): `FAILED/fetch_failed`,
  `sourceUrl` mantida server-side, leitura do asset EXTERNAL associado **409**
  `MEDIA_ASSET_PENDING_SCAN`; revalidação reusa `recoverPendingInboundMedia`
  (`revalidated>0`) e continua indisponível;
- **1 `asset://` quebrado**: referência neutralizada (`media_url=null`) com `legacyRef`
  preservada no metadata e mensagem intacta; leitura **404** `MEDIA_ASSET_NOT_FOUND`.
Reexecução: `assets 11→11`, `messages 16→16`, `published=0` na segunda passada — nenhuma
duplicação nem remoção de mensagem. DTO da conversa legada sem URL crua/`sourceUrl`/
`legacyRef`; nenhum não-pronto servido.

**MinIO:** permanece **BLOCKED** (dono: plataforma); a prova de storage continua via
moto server 5.2.3 (S3-protocol sandbox) — sem conversão em PASS.

---

## 4. Comandos e resultados

| # | Comando | Exit |
|---|---|---|
| 1 | `pnpm --filter @cvg/media typecheck` | 0 |
| 2 | `pnpm --filter @cvg/chat typecheck` | 0 |
| 3 | `pnpm --filter @cvg/desk-api typecheck` | 0 |
| 4 | `pnpm --filter @cvg/media lint` | 0 |
| 5 | `pnpm --filter @cvg/chat lint` | 0 (8 warnings pré-existentes = baseline `--max-warnings 8`) |
| 6 | `pnpm --filter @cvg/desk-api exec eslint src/__tests__/production/prod-14.test.ts --max-warnings 0` | **0** (F2 corrigido) |
| 7 | `pnpm --filter @cvg/desk-api lint` | 0 (0 errors, 5 warnings = baseline) |
| 8 | `AAA_PG_PORT=58832 AAA_REDIS_PORT=58842 node scripts/production/run-integration-isolated.mjs --run-id prod14 --worker 23 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-14.test.ts` | **0** — 10/10 (execução original AC1–AC3) |
| 9 | `node scripts/production/run-integration-isolated.mjs --run-id prod14-rework --worker 37 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-14.test.ts` | **0** — **12/12** (AC1–AC4, 13.25s) |
| 10 | `AAA_PG_PORT=60932 AAA_REDIS_PORT=57160 node scripts/production/run-integration-isolated.mjs --run-id prod14-rework-media --worker 38 -- pnpm --filter @cvg/media exec vitest run` | 0 — 26 passed, 21 skipped (flags reais ausentes; sem regressão) |
| 11 | `… --run-id prod14-reg-media --worker 24 -- pnpm --filter @cvg/media exec vitest run` | 0 — 26 passed, 21 skipped |
| 12 | `… --run-id prod14-reg-chat2 --worker 31 -- pnpm --filter @cvg/chat exec vitest run --exclude '**/aaa-08-atomicity.test.ts'` | 0 — 34/34 |
| 13 | `… --run-id prod14-reg-chatroutes --worker 26 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/chat-routes.integration.test.ts` | 0 — 5/5 |
| 14 | `… --run-id prod14-reg-prod08 --worker 27 -- … prod-08.test.ts` | 0 — 19/19 |
| 15 | `… --run-id prod14-reg-prod07 --worker 28 -- … prod-07.test.ts` | 0 — 9/9 |
| 16 | `… --run-id prod14-reg-outbound --worker 29 -- … outbound-idempotency.integration.test.ts` | 0 — 8/8 |
| 17 | `… --run-id prod14-repro --worker 30 -- pnpm exec tsx docs/producao-2026-09-13/evidencias/prod-14/repro-antes.ts` | 0 |

Notas de ambiente: as execuções 8 e 11–17 são da rodada original, preservadas como
regressão; as execuções 9–10 são desta revisão. Worker 37 usa PG=60132/Redis=57050 (livres);
o teardown do runner e o `afterAll` da suíte encerram PG/Redis por run-id (verificado: portas
fechadas após a execução). `aaa-08-atomicity.test.ts` não roda fora do namespace fixo
56432/`cvg_aaa_…_a8` (guard pré-existente) — os demais arquivos do chat passam.

## 5. Evidências

- `docs/producao-2026-09-13/evidencias/prod-14/prod-14-evidence.json` (12 casos AC1–AC4)
- `docs/producao-2026-09-13/evidencias/prod-14/prod-14-ac4-dry-run.json`
  (contagens por tipo, itens/fixtures, `zeroMutations: true`)
- `docs/producao-2026-09-13/evidencias/prod-14/prod-14-ac4-migration.json`
  (1 publicado, 1 bloqueado, pendentes, indisponível, HTTP 200/422/404/409/403,
  idempotência `assets 11→11`/`messages 16→16`, `revalidated`)
- `docs/producao-2026-09-13/evidencias/prod-14/repro-antes.ts|.json`
- `docs/producao-2026-09-13/evidencias/prod-14/logs/moto-server.log`
- `docs/producao-2026-09-13/evidencias/integration-runs/prod14-rework/{runner-summary.json,runner-output.log}`
- `…/integration-runs/prod14-rework-media/`, `…/prod14/{…}`, `…/prod14-reg-*` e `…/prod14-repro`

## 6. Riscos e limitações

1. **UI04 (gap assumido):** Inbox ainda não consome o endpoint autenticado; mídia inbound
   CLEAN aparece como chip. Não há render de URL crua (DTO anula).
2. **MinIO ausente:** prova S3 via moto sandbox; MinIO real BLOCKED (dono plataforma).
3. **Crash físico não simulado com kill de processo:** a recuperação é provada por
   idempotência (lock + chave determinística + `recoverPendingInboundMedia`) e pelo estado
   retentável persistido; falta ensaio com SIGKILL entre fetch/scan/store.
4. **Fetch remoto positivo real não exercitado** contra host público (SSRF bloqueia
   loopback/DNS privado por design): o caminho positivo usa data-URL; o http(s) legado é
   provado no negativo (fetch falho → pendente revalidável). Não foi enfraquecido.
5. `metadata.mediaIntake.sourceUrl`/`legacyRef` permanecem server-side para retry/rastreio;
   removidos em estados terminais e sempre filtrados do DTO.
6. `media_assets` marcados `EXTERNAL` continuam rastreados como legado até haver cópia
   controlada; a migração não os apaga (histórico preservado). Mensagens nunca são apagadas.

## 7. Recuperação / rollback

- Feature flag `MEDIA_PIPELINE_ENABLED=false` desliga o pipeline sem expor URL crua
  (kill-switch operacional; a migração legada respeita a flag via `enqueue`/recover).
- Reverter o delta original: `git checkout -- packages/media/src/index.ts packages/media/src/repository.ts
  packages/media/src/__tests__/media-pipeline.test.ts modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts
  modules/chat/src/application/use-cases/index.ts modules/chat/src/presentation/http/outbound.controller.ts
  modules/chat/src/presentation/http/webhook-inbound.controller.ts modules/chat/src/presentation/http/index.ts
  apps/desk-api/src/app.ts` + remover os arquivos novos
  (`inbound-media-pipeline.ts`, `media-read.controller.ts`, `message-dto.ts`, `prod-14.test.ts`,
  `evidencias/prod-14/**`).
- Reverter o delta AC4 desta revisão: remover `packages/media/src/legacy.ts` e
  `modules/chat/src/application/use-cases/legacy-media-migration.ts`, remover as duas linhas
  de export (`packages/media/src/index.ts:24`, `application/use-cases/index.ts:7`) e as
  adições de `asset_unavailable`/`awaiting_revalidation`/`legacyRef` em
  `inbound-media-pipeline.ts`; `git checkout -- apps/desk-api/src/__tests__/production/prod-14.test.ts`
  ou remover apenas os dois casos AC4. Sem schema/dados a reverter.
- Teardown restrito por run-id (`prod14*`); nenhum serviço/banco do host foi usado.

## 8. Aditivo R2 — BE-A04

As seções acima preservam o relatório original de AC1–AC4. A revalidação
posterior do achado BE-A04 adicionou `0029_media_intake_recovery.sql`, claim
durável no `message-worker`, retry de `SCAN_FAILED`, backoff/limite e prova de
concorrência. O resultado atual está em
`docs/melhorias-2026-09-13/evidencias/PROD-14-R2.md` e na nota integrada
`docs/producao-2026-09-13/evidencias/R2-REVALIDACAO-2026-09-13.md`.

O aditivo não fecha PROD-14 como DONE: o `SIGKILL` físico entre commit e
enqueue e a execução com MinIO real permanecem pendentes/BLOCKED.
