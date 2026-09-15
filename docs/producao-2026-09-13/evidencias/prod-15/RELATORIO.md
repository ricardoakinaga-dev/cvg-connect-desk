# PROD-15 — Relatório de execução (validar upload e resolução autorizada de assets)

**Tarefa:** PROD-15 (BE15/BE10/UI04 · G04 · C06) · **Data:** 2026-09-13 · **Executor:** agente backend mídia/plataforma
**Candidato:** `754f9badac46278e77d21de91c58eedb15e80581` + worktree de produção (deltas PROD-04..PROD-16 não commitados preservados)
**Estado:** AC1–AC4 provados nesta execução; **não** declaro DONE (fechamento é do integrador/PROD-40)

---

## 1. Problema confirmado e repro do antes

O achado BE15 no candidato era **cobertura ausente, não defeito funcional** (auditoria de
2026-09-13, linha 58): "Upload dedicado e entrega asset CLEAN; 6 testes media-security-final
PASS. **MinIO/ClamAV reais e 16MiB HTTP NOT_RUN.**" A suíte de contrato AAA-10 existia, mas
gated por namespace fixo (`DATABASE_URL` em `127.0.0.1:56432` / `cvg_aaa_aaa_20260912_a10` +
marcador) e por `AAA10_REAL_SERVICES=1`; `prod-15.test.ts` e `evidencias/prod-15/` não existiam.

Repro do antes com o runner isolado (artefato `repro-antes.json`):

| Antes | Observado |
|---|---|
| `prod-15.test.ts` | ausente (TO_CREATE) |
| `evidencias/prod-15/` | ausente |
| `packages/media` com serviços reais | `26 passed \| 21 skipped (47)`: `aaa-10-media-boundary` 8/8 skipada (flag) e `minio-real` 7/7 skipada (staging) |
| `aaa-10.integration.test.ts` (desk-api) | fora do runner do cartão (namespace AAA-10 fixo) |
| MinIO | BLOCKED em `prod-00/environment/availability.json` (sem binário; Docker sem permissão no socket; dono: plataforma) |
| ClamAV | `availability.json` dizia ausente, mas há **clamd real** em `127.0.0.1:53110` (reutilizado do PROD-14; `zPING` responde) |

Limite atual medido: `getMediaMaxBytes()=16 MiB` (16777216), nginx `client_max_body_size 17m`,
parser binário `16777216 + 4096` de overhead, TTL assinado `MEDIA_SIGNED_URL_TTL_SECONDS` (120s
na prova).

---

## 2. Delta implementado

**Nenhum código de produção precisou de alteração.** A linha produtiva
(`media-upload.controller.ts`, `media-read.controller.ts`, `send-outbound-message.use-case.ts`,
`packages/media/src/**`) já satisfazia AC1–AC4; o delta deste cartão é a **prova de aceite no
runner isolado**, que era exatamente a lacuna registrada pela auditoria.

| Arquivo | Mudança |
|---|---|
| `apps/desk-api/src/__tests__/production/prod-15.test.ts` (**novo**, 12 casos) | Suíte de aceite AC1–AC4 com PostgreSQL isolado, **storage S3 real via moto 5.2.3** (processo do próprio run, bucket por run) e **scanner ClamAV real** (`clamd` 127.0.0.1:53110). HTTP real (`app.listen` + `fetch`), não `inject`, para exercitar chunked, abort e o contrato de transporte. Provider outbound é dublê de gravação que **confere a URL assinada no ato do envio** (o que se julga é a entrega/gating, não o WhatsApp). |
| `docs/producao-2026-09-13/evidencias/prod-15/**` (**novo**) | este relatório, `repro-antes.json`, `prod-15-evidence.json`, `logs/moto-server.log`, `runtime/**`. |

Fronteiras respeitadas: **nenhuma** edição em `packages/auth`, `modules/privacy`,
`schema/migrations`, `contact-groups`, `conversation.repository` ou
`outbound-atomic.repository` (PROD-11 intacto). Nenhum `skip`/`.only`/`TODO` introduzido.

SHA-256 dos artefatos do delta:

```
f33672b03fdac86cb97aeb4a0c5f6d11b49669763d4e43355d904b387c05ed0e  apps/desk-api/src/__tests__/production/prod-15.test.ts
36191edfd604771c0dc63ae7cbaa468703afb4235d5b5f1d886117046d051643  docs/producao-2026-09-13/evidencias/prod-15/prod-15-evidence.json
244f69b8e6c827d75111aec97eadb861e995f53884a94a9cb947484e3982e3fe  docs/producao-2026-09-13/evidencias/integration-runs/prod15/runner-summary.json
```

---

## 3. Critérios de aceite (PROD-15)

Fonte primária: `prod-15-evidence.json` (12 casos, run `prod15`, worker 41, PG
`cvg_aaa_prod15_w41`, moto `127.0.0.1:40177`, clamd `127.0.0.1:53110`).

### AC1 — limite/validação/SSRF/fail-closed — **PASS (real)**

- **16 MiB exatos aceitos**: upload HTTP 201, `sizeBytes=16777216` e objeto no S3 com
  `ContentLength=16777216` (consistência HTTP↔storage).
- **+1 por Content-Length → 413** `PAYLOAD_TOO_LARGE` `recoverable:true` `maxBytes=16777216`.
- **+1 sem Content-Length (stream/chunked) → 413**; **+8192 (acima do teto duro do parser) →
  413** com o mesmo contrato recuperável. A leitura é capada em `maxBytes` (nunca bufferiza
  indefinidamente) e aborta cedo.
- **Allowlist/magic bytes**: MIME não permitido → 415 `MEDIA_MIME_NOT_ALLOWED`; PNG declarado
  PDF → 415 `MEDIA_MIME_MISMATCH`; MZ/ELF disfarçados de PDF → 415 `MEDIA_EXECUTABLE_CONTENT`;
  nenhum gera linha em `media_assets`.
- **EICAR real (ClamAV)** → 422 `MEDIA_INFECTED`, `INFECTED/QUARANTINED` em `quarantine/…`
  (bytes preservados, sha256 conferido), **sem cópia em `media/`** e GET anônimo no S3 **403**.
- **Fail-closed de serviço**: scanner ausente → 503 `SCANNER_UNAVAILABLE` com
  `PENDING_SCAN/QUARANTINED`; timeout de clamd (blackhole, 2s) → 503 `SCAN_FAILED` com bytes
  preservados; storage fora (driver real apontado a porta fechada) → 503
  `MEDIA_STORAGE_UNAVAILABLE` `recoverable:true` sem asset. Todos `retryable/recoverable`.
- **Abort/cancel**: upload interrompido após escrita parcial não cria asset nem objeto e não
  remove/altera nenhum asset do run (contagens de `media/`+`quarantine/` e leitura do asset
  CLEAN preexistente permanecem íntegras).
- **SSRF/URL arbitrária no outbound**: `mediaUrl` http/link-local/data-URL → 400
  `MEDIA_ASSET_REQUIRED`; `mediaAssetId` + `mediaUrl` → 400 `MEDIA_URL_NOT_ALLOWED`; nenhum
  request chega ao gateway.
- **Config implantada**: nginx `client_max_body_size 17m` + `@api_payload_too_large`; compose
  `MEDIA_MAX_BYTES:-16777216`, `MEDIA_REQUIRE_SCAN: all`, `MEDIA_PIPELINE_ENABLED:"true"`,
  `MALWARE_SCANNER: clamav`.

### AC2 — leitura autorizada, asset privado, TTL, negativos — **PASS (real)**

- CLEAN lido por ator com `chat:read` + membership da conversa: **200**, bytes idênticos,
  `content-type: image/png`, `cache-control: private, max-age=120`, `x-content-type-options:
  nosniff`, sem `X-Amz-Signature` no corpo; objeto S3 anônimo **403** (asset privado).
- **Sem vazamento entre conversas**: asset da conversa A visto pela URL da conversa B → **404**
  genérico sem bytes; ator sem membership → 404; sem token → 401; asset inexistente/adulterado
  → 404; `assetId` fora de UUID → 400.
- **Estados**: INFECTED → 422 `MEDIA_ASSET_INFECTED`; PENDING → 409 `MEDIA_ASSET_PENDING_SCAN`;
  SCAN_FAILED → 503 `MEDIA_ASSET_SCAN_FAILED`; revogado (status `DELETED`) → 409 e envio 409;
  objeto removido do storage → 503 recuperável. Nenhum devolve bytes.
- **TTL coerente**: `MEDIA_SIGNED_URL_TTL_SECONDS=2` reflete em `X-Amz-Expires=2`
  (`resolveDeliverableAsset`) e em `Cache-Control: private, max-age=2` (proxy de leitura); URL
  base sem assinatura → 403.

### AC3 — ciclo completo e idempotência — **PASS (real)**

- **Upload → CLEAN → envio por asset → entrega**: upload 201 `CLEAN/STORED`; `POST /messages`
  com `mediaAssetId` + `Idempotency-Key` → 201 `accepted`; o gateway recebe `attachmentUrl`
  (URL assinada, sem `asset://`) e a **busca real dessa URL devolve 200 com bytes/sha256
  idênticos**. Mensagem persiste `media_url=asset://<id>`, `media_type=image`,
  `media_mimetype=image/png`; DTO devolve só `asset://`, sem assinatura/endpoint.
- **Retry do envio** com a mesma chave → 200 `deduplicated:true`, mesmo `messageId`, **1**
  mensagem/1 delivery/1 asset, **gateway chamado 1×** (não duplica upload/asset).
- **INFECTED/PENDING/SCAN_FAILED** no envio → 409 `MEDIA_ASSET_NOT_CLEAN` sem side effect;
  asset inexistente → 404; asset de outra conversa → 403 `MEDIA_ASSET_FORBIDDEN`; URL
  arbitrária rejeitada como em AC1.
- **Falha de scanner/storage claramente recuperável**: 503 `retryable/recoverable` (AC1), com
  bytes em quarentena retentável.

### AC4 — inbound PROD-14 + legado sem regressão — **PASS (real)**

- **Integração inbound**: webhook HMAC `/gateway/inbound` com imagem → pipeline PROD-14
  entrega `asset://` `CLEAN/STORED` (`media/<conv>/<msg>/…`); leitura HTTP 200 com bytes
  idênticos; **envio outbound referenciando o asset inbound** → 201 e URL assinada conferida
  (mesmo bytes).
- **Legado**: `dryRunLegacyMediaMigration` **read-only** (snapshot de `messages`+`media_assets`
  idêntico antes/depois; 3 candidatos do escopo); `migrateLegacyInboundMedia` publica o
  data-URL CLEAN em `media/` (leitura 200 e entrega outbound 201), mantém o http legado
  `FAILED/fetch_failed` com `sourceUrl` server-side e neutraliza `asset://` quebrado
  preservando `legacyRef`; **reexecução idempotente** (`assets 16→16`, `messages 7→7`,
  publicado=0).
- **Nenhum caminho serve URL crua**: DTO de mensagens e listagem de conversas sem
  `legacy.prod15.invalid`, `data:image/png` ou `sourceUrl`; só `asset://<id>`.
- **Regressões reais pelo runner** (tabela §4): PROD-14 12/12, media 26 passed/21 skipped
  (baseline), chat 34/34, outbound-idempotency 8/8 — nenhuma regressão.

---

## 4. Comandos e resultados

Runner isolado (nunca o banco do host; PG/Redis por run, banco `cvg_aaa_prod15*_w41`,
teardown `stopServices+dropDatabase` por runId). A execução final pinou portas livres
(`AAA_PG_PORT=60632 AAA_REDIS_PORT=57100`) porque outro executor ocupou `60532/57090`
(`prod12-reg-events`) na janela; run-id/worker permanecem `prod15`/41.

| # | Comando | Exit | Resultado |
|---|---|---|---|
| 1 | `pnpm --filter @cvg/desk-api typecheck` | 0 | sem erros (inclui `prod-15.test.ts`) |
| 2 | `pnpm --filter @cvg/desk-api exec eslint src/__tests__/production/prod-15.test.ts --max-warnings 0` | 0 | 0 problemas |
| 3 | `AAA_PG_PORT=60632 AAA_REDIS_PORT=57100 node scripts/production/run-integration-isolated.mjs --run-id prod15 --worker 41 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-15.test.ts` | **0** | **12/12 casos**, 18.6s |
| 4 | `node scripts/production/run-integration-isolated.mjs --run-id prod15-reg-p14 --worker 41 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-14.test.ts` | 0 | 12/12 (regressão inbound) |
| 5 | `… --run-id prod15-reg-media --worker 41 -- pnpm --filter @cvg/media exec vitest run` | 0 | 26 passed / 21 skipped (baseline: aaa-10 e minio-real gated) |
| 6 | `… --run-id prod15-reg-chat --worker 41 -- pnpm --filter @cvg/chat exec vitest run --exclude '**/aaa-08-atomicity.test.ts'` | 0 | 34/34 |
| 7 | `… --run-id prod15-reg-outbound --worker 41 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/outbound-idempotency.integration.test.ts` | 0 | 8/8 |
| 8 | `… --run-id prod15-baseline-p14 --worker 41 -- … prod-14.test.ts` | 0 | 12/12 (validação de ambiente antes do delta) |

Nota de ambiente: a suíte final (`prod15` em 15:15) usou PG `60632`/Redis `57100`; o runner
registrou `runner-summary.json` com `exitCode: 0` e as portas foram confirmadas fechadas após o
teardown. `aaa-08-atomicity.test.ts` não roda fora do namespace fixo `56432` (guard
pré-existente), como em PROD-14.

Artefatos: `evidencias/integration-runs/prod15{,-reg-p14,-reg-media,-reg-chat,-reg-outbound,-baseline-p14}/{runner-summary.json,runner-output.log}`,
`evidencias/prod-15/{prod-15-evidence.json,repro-antes.json,logs/moto-server.log}`.

---

## 5. Riscos e limitações (honestos)

1. **MinIO real continua BLOCKED** (sem binário local; Docker sem permissão no socket; dono:
   plataforma). A prova de storage é o sandbox S3 por protocolo (moto 5.2.3), como em PROD-14 —
   sem conversão em PASS de MinIO.
2. **Moto não é oráculo de assinatura/expiração**: no probe, URL com `X-Amz-Signature`
   adulterada devolveu **200** (blind spot do sandbox, registrado em
   `AC2-ttl-assinatura.forgedSignatureStatus=200`) e a expiração por relógio não é aplicada.
   O que ficou provado aqui: TTL emitido/`Cache-Control` coerentes, URL base sem assinatura
   negada (403) e ausência de exposição de URL assinada nas rotas. **HMAC de URL assinada e
   expiração por tempo são garantias do S3/MinIO real** e fecham junto com o desbloqueio do
   MinIO (dono: plataforma).
3. **UI04 permanece parcial** (fora do escopo de escrita deste cartão): o Inbox ainda não
   consome `GET /conversations/:id/media/:assetId` para preview/download de vídeo/documento;
   nenhuma URL crua é renderizada (DTO anula). Fica para PROD-20.
4. **`não` há limpeza automática de órfãos de upload** (asset CLEAN sem mensagem) — retenção é
   D-B5; este cartão não introduz job de GC nem o promete.
5. **A prova de crash físico (SIGKILL) do upload não foi refeita**: coberta indiretamente por
   idempotência de send (PROD-11) e por abort de transporte; a lacuna de crash entre store e
   resposta HTTP é de recuperação/retention (não de segurança).
6. **Sem alteração de schema/migrations**; nenhum lock alheio tocado (`schema-migrations`,
   `api-composition` preservados).

---

## 6. Recuperação / rollback

- **Rollback do delta**: remover `apps/desk-api/src/__tests__/production/prod-15.test.ts` e
  `docs/producao-2026-09-13/evidencias/prod-15/**`. Não há código de produção, schema ou dados
  a reverter.
- **Dados**: nenhum. Toda a prova rodou em PostgreSQL/Redis/moto do run isolado, com teardown
  por runId (`stopServices+dropDatabase`); nada do host foi usado ou apagado.
- **Operacional** (sem rollback): com `MEDIA_STORAGE_DRIVER=s3` e `MALWARE_SCANNER=clamav`, o
  upload fora de escopo falha fechado (quarentena/503) e nenhuma mídia não-CLEAN é publicada;
  o kill-switch de inbound (`MEDIA_PIPELINE_ENABLED=false`) não afeta o outbound validado.

O fechamento DONE depende do integrador conferir identidade do candidato, revisão e os
aceites acima; PROD-40 inspeciona independentemente.
