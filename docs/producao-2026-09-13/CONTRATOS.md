# Contratos de integração

> Histórico de planejamento/execução. Estado atual e próximas ações: [auditoria das entregas](../auditorias/2026-09-13-entregas/RELATORIO.md) e [programa R2](../melhorias-2026-09-13/README.md). Requisitos preservados; status e provas abaixo têm o contexto original.

Estes são requisitos a fechar em PROD-01, não novos DTOs já implementados. C01/C02 preservam os recortes anteriormente congelados; revalidar no candidato.

**Estado do fechamento (PROD-01, 2026-09-13):** contratos C01–C10 mapeados no candidato `754f9ba` + worktree; produtor, consumidor, erros, testes e lacuna registrados por contrato. Onde a prova depende de serviço/ambiente ainda ausente, o estado é NOT_RUN/BLOCKED com dono na tarefa executora. Nenhuma ratificação de produto/dados foi inventada. Recortes já congelados de sessão/canal foram preservados.

| ID | Contrato | Produtor → consumidor | Invariantes |
|---|---|---|---|
| C01 | Sessão | Auth → HTTP/WS/web | Token opaco armazenado como hash; 7d normal, 30d absoluto, 24h idle; limite exato nega; rotação não estende deadline absoluto. |
| C02 | Autorização | Auth/admin → módulos/WS/web | Ação + recurso, setores e exceções explícitas; papéis efetivos, 401/403/404 coerentes; revogação WS ≤5s. |
| C03 | Ingresso | Gateway → API/DB/worker | HMAC, bytes e relógio; recibo recuperável, dedup por identidade/payload; uma conversa lógica e persistência atômica. |
| C04 | Eventos | Outbox → worker/realtime/poll | Versão, eventId, causa/correlação; lease com owner/generation; efeito idempotente, falha não ACK, DLQ durável. |
| C05 | Envio | Web/API → Gateway → callback | Intenção idempotente, conflito409, estado ambiguous/unknown explícito, reconciliação sem reenvio cego. |
| C06 | Mídia | Gateway/web → worker/storage → leitor | Asset privado, scan/quarentena, clean/stored, leitura autorizada, TTL, SSRF e limite16MiB consistente. |
| C07 | Operação do atendimento | Módulos → web/Kanban/realtime | DTOs de filtros/paginação/contexto, transições, responsáveis, handoff, notas/tarefas/alertas e eventos pós-commit. |
| C08 | Dados e IA | Dados/admin/Secretary → consumidores | Relação tutor–paciente ratificada; budget persistente, `invocationId` estável para retry idempotente e ferramentas aprovadas; privacidade e restores compatíveis. |
| C09 | Runtime | Config/infra → API/worker/realtime/web | Boot/preflight equivalentes, dependências críticas, health/readiness, TLS/WSS, graceful shutdown e telemetria. |
| C10 | Evidência e release | Testes/CI → agregador/operador | Manifesto com identidade fonte/lock/imagem/run/ambiente; provas atuais, política por evento, gates obrigatórios e autoridade explícita. |

## Fichas por contrato (candidato 754f9ba + worktree)

### C01 — Sessão (v1, congelado)
- Produtor: `packages/auth/src/session-policy.ts:47-55` (7d/30d/24h), `:75 resolveSessionDeadlines`, `:103 evaluateSession` (nega no limite exato); `packages/auth/src/infrastructure/repositories/auth.repository.ts:17 hashSessionToken` (sha256), `:113 createSession` (teto absoluto), `:183 rotateSession` (não estende absoluto).
- Consumidor: `packages/auth/src/middleware.ts:18 authenticate` (401); `presentation/http/auth.controller.ts:21 login/:113 logout/:143 logout-all/:190 rotate/:225 me`; `apps/realtime-service/src/index.ts:346 validateTokenAndAuthenticate`, `:553` revalidação.
- Erros: 401 `UNAUTHORIZED`; razões `invalid_token|expired|absolute_expired|idle|inactive_user`.
- Positivo/negativo: login devolve token opaco e persiste hash; rotação + concorrência + idle/absoluto negados (ver testes).
- Compatibilidade: aditivo; token opaco sem mudança de formato. Mudanças exigem decisão do integrador.
- Prova: `packages/auth/src/__tests__/session-policy.test.ts:67-129` (limite exato) e `apps/desk-api/src/__tests__/aaa-03.integration.test.ts:169-347` (PG real; NOT_RUN no worktree, reexecutar em PROD-05).
- Evidência requerida: execução HTTP+PG no candidato (PROD-05).

### C02 — Autorização (v1, congelado)
- Produtor: `packages/auth/src/authorize.ts:79`, `:58 SENSITIVE_ACTIONS`; `packages/auth/src/resource-authz.ts:66 authorizeConversationResource` (404 sem membership, 403 de nível); `sector-permissions.ts`.
- Consumidor: `rbac-middleware.ts:17 requirePermission`, `:83 requireSectorAccess`; controllers de módulos; `apps/realtime-service/src/authorization.ts:55 createDatabaseAuthorizationPort` (`chat:read` antes do recurso).
- Erros: 401/403/404 estáveis.
- Lacuna (P0, PROD-04): GET /conversations chama helper de recurso sem exigir `chat:read`; Kanban move só usa helper; builder de query não deve tratar ausência de setores como admin.
- Prova: `apps/desk-api/src/__tests__/aaa-04.integration.test.ts`, `sector-authz.integration.test.ts`, `dynamic-permissions.integration.test.ts` (PG real; NOT_RUN) e `aaa-05.integration.test.ts:459-467` (revogação WS ≤5s, socket real).
- Evidência requerida: matriz HTTP/WS por ator no candidato (PROD-04).

### C03 — Ingresso
- Produtor: `packages/shared/src/webhook-guard.ts:67/:204` (HMAC timing-safe); `webhook-anti-replay.ts:16` (skew 300s), `:99 PostgresWebhookReplayStore`; `modules/chat/.../webhook-inbound.controller.ts:17`; `inbound-atomic.repository.ts:77 persistInboundAtomically` (conversa+mensagem+outbox na mesma transação); `message.repository.ts:42 createIdempotent` (unique `externalMessageId`).
- Payload: `InboundMessageV1Schema` (`packages/messaging-contracts/src/inbound.ts:11`); headers `X-Webhook-Signature/Timestamp/Event-Id`.
- Erros: 401 `invalid_signature`; payload diferente ou entrega concorrente → 409;
  evento já concluído → 200 idempotente (`deduplicated: true`); skew >300s rejeitado.
- Lacuna (P0, PROD-07): replay registrado antes do commit do negócio e erro do store engolido — retry legítimo vira 409. Dedup por payload/hash não é consultada.
- Prova: `webhook-inbound.integration.test.ts`, `resilience.integration.test.ts` (PG real; NOT_RUN no worktree).
- Evidência requerida: injeção de falha pós-HMAC + reenvio do mesmo evento (PROD-07).

### C04 — Eventos
- Produtor: `packages/events/src/outbox-publisher.ts:54`, `:84`; `envelope.ts:15 createEvent`; `outbox-lease.ts:112 PostgresOutboxLease` (owner+generation, fence em ack/nack); `outbox-reader.ts:162`; `persistent-dead-letter.ts:50`; migrations 0015/0019.
- Consumidor: `apps/message-worker/src/index.ts:164 processEventFromOutbox` (ack/nack/DLQ); `apps/desk-api/src/app.ts:527 GET /events`, `:596 ack`; `realtime-bus.ts:62`.
- Erros: `acked|retry|dead-letter|stale|not_found`.
- Lacuna (P0, PROD-09): handler que engole `Err` (createAlert) resolve e dá ACK — efeito perdido/duplicado.
- Prova: `packages/events/src/__tests__/aaa-07-lease-real.test.ts` (PG real; NOT_RUN), suítes de outbox/DLQ; fanout entre processos é PROD-12.
- Evidência requerida: crash/retomada com exatamente um efeito (PROD-09) e leases/DLQ entre processos (PROD-12).

### C05 — Envio
- Produtor: `modules/chat/.../outbound-atomic.repository.ts:148` (advisory lock/fingerprint), `:295 unknown_reconciling`, `:320` 409; `send-outbound-message.use-case.ts:53/:87/:171/:224-279`.
- Consumidor: `outbound.controller.ts`; `gateway.controller.ts:91 /gateway/receipt`; `outbound-delivery.repository.ts:10`.
- Erros: 409 `ConflictError`; TTL expirado com `expired:true`; ambíguo sem reenvio cego.
- Prova: `aaa-12.integration.test.ts`, `outbound-idempotency.integration.test.ts` (PG real; NOT_RUN).
- Evidência requerida: reconciliação e retenção da intenção (PROD-11).

### C06 — Mídia
- Produtor: `packages/media/src/index.ts:308 ingestUploadedMedia` (16MiB, magic bytes, quarentena, CLEAN→STORED, sem scanner fail-secure), `:389 resolveDeliverableAsset`; `packages/shared/src/media-policy.ts:14/:76/:240/:302` (SSRF/DNS rebinding); `scanner.ts:78 ClamAVScanner`.
- Consumidor: `modules/chat/.../media-upload.controller.ts:61` (413 recuperável); envio referencia asset autorizado.
- Erros: 413 `PAYLOAD_TOO_LARGE`; `asset_not_found|asset_not_clean|wrong_conversation`.
- Lacuna (P0, PROD-14): pipeline inbound definido mas sem chamador produtivo — mediaUrl é persistida direto; scanner/quarentena não atravessam o webhook.
- Bloqueio de ambiente: MinIO/ClamAV ausentes localmente (`evidencias/prod-00/environment/availability.json`); provas dependentes BLOCKED com dono.
- Prova: `packages/media/src/__tests__/aaa-10-media-boundary.test.ts` (HTTP+S3+ClamAV+PG), `media-security-final.test.ts`; NOT_RUN.
- Evidência requerida: CLEAN entregue e INFECTED/PENDING/timeout indisponíveis via webhook/HTTP/UI (PROD-14/15).

### C07 — Operação do atendimento
- Produtor: `modules/chat/.../outbound.controller.ts:199 GET /conversations` (cursor opaco; 400 INVALID_CURSOR), Kanban/transfer/note/task/alert controllers; eventos pós-commit `chat-publisher.ts`, `packages/events/src/handoff-events.ts`.
- Consumidor: desk-web, Kanban, realtime.
- Lacuna: hints pós-commit são best-effort (`inbound-atomic.repository.ts:148-151`); nota/tarefa/alerta usam `limit` sem cursor; contexto hospitalar incompleto na UI (UI05).
- Prova: `aaa-11.integration.test.ts`, `kanban-routes.integration.test.ts`, `transfers-routes.integration.test.ts`, `chat-routes.integration.test.ts` (PG real; NOT_RUN).
- Evidência requerida: DTOs/transições/handoff por fluxo integrado (PROD-18/19/27).

### C08 — Dados e IA
- Produtor: `modules/secretary-adapter/.../ai-policy.ts:27/:116`, `ai-tools.ts:31/:100/:132`; migration 0017; `modules/privacy/.../data-subject-service.ts`, `scoped-export.ts`; `contact-graph.ts:76`.
- Consumidor: `invoke-secretary.use-case.ts:45-73`; pacientes/tutores; Inbox.
- Erros: 403 `AI_POLICY_DENIED`; deny por padrão para ferramenta não aprovada.
- Lacuna (P2, PROD-13): `invoke-secretary.use-case.ts:52` passa `priorInvocations: 0` fixo — budget por conversa nunca dispara no fluxo real.
- Decisão: D03 OPEN; D05 OPEN. N:N tutor–paciente **não implementado** (proposta em `evidencias/prod-06/D03-PROPOSTA.md`).
- Prova: `ai-policy.test.ts`, `ai-tools.test.ts` (PG real), `aaa-17.integration.test.ts`, `privacy-dsar.integration.test.ts`; NOT_RUN.
- Evidência requerida: budget durável/concorrente + política de privacidade ratificada (PROD-13/16/25).

### C09 — Runtime
- Produtor: `apps/desk-api/src/app.ts:408 /health`, `:432 /readiness` (503 com DB/migrations/Redis); `runtime-config.ts:39/:55/:165`; worker `apps/message-worker/src/index.ts:315`; realtime `index.ts:1254/1307/1316`; tracing.
- Consumidor: compose/CI/ops; `/metrics` token (`app.ts:218/:241`).
- Erros: 503 readiness; 401 metrics.
- Lacunas: worker `/health` incondicional e probe Docker só SELECT1; TLS/WSS externo sem prova; preflight de boot limitado.
- Prova: `aaa-09.integration.test.ts` (NOT_RUN), `runtime-config.test.ts`, `metrics.integration.test.ts`; HTTP real atual apenas no PROD-00 (`prod-00/checks/`).
- Evidência requerida: readiness/falha de dependência no candidato (PROD-36) e tracing real (PROD-32).

### C10 — Evidência e release
- Produtor: `scripts/triple-aaa-verify.mjs --run/--evaluate` + `scripts/production/evidence-gate.mjs`; `.github/scripts/certification-aggregator.mjs:35 REQUIRED/:101 POLICIES/:442 CERTIFICATION_POLICY`; workflows `triple-aaa-gate.yml`, `triple-aaa-certification.yml`, `ci.yml`.
- Estados: PASS/FAIL/BLOCKED/NOT_RUN/SKIPPED; `CERTIFIED` nunca emitido localmente.
- Política por evento: PR exige dependency-review; push aceita skip só com substituto `audit`; release exige coverage-global/load (BLOCKED com dono).
- Prova: `scripts/production/prod-02.test.mjs` (17), `prod-03.test.mjs` (16), `certification-aggregator.test.mjs` (51) — reexecutados no candidato.
- Limite: execução real no GitHub Actions e branch protection remotos NÃO comprovados (sem runner/rede `gh`); registrado como BLOCKED com dono.
- Evidência requerida: manifesto selado do candidato final (PROD-40/41).

## Versão, compatibilidade e payloads por contrato

| Contrato | Versão | Payload positivo (exemplo) | Payload negativo (exemplo) | Compatibilidade durante rollout |
|---|---|---|---|---|
| C01 | v1 (congelado) | `POST /auth/login {email,password}` → `{token, user}`; `token` opaco | token expirado/idle/absoluto ou revogado → 401 `UNAUTHORIZED` | Aditivo; consumidores leem `token`/`me`; nada removido sem nova versão |
| C02 | v1 (congelado) | `GET /conversations` com sessão cujo papel tem `chat:read` e membership no setor | ator sem papel, sem membership, setor divergente ou revogado → 401/403/404 | Aditivo; WS revalida com a mesma fonte; nenhum bypass transitório |
| C03 | v1 | webhook com HMAC+timestamp válidos e `eventId` novo → 2xx e mensagem persistida 1× | assinatura inválida → 401; skew >300s → rejeitado; evento já aplicado → 2xx idempotente | Produtor e consumidor no mesmo deploy; dedup por identidade antes de payload |
| C04 | v1 (envelope canônico) | evento `message.persisted` com `eventId`, `version`, `causationId` → consumido 1× e ACK | lease expirado/stale → `stale`; handler com falha → DLQ, sem ACK | Novos campos são aditivos; consumidores antigos ignoram desconhecidos |
| C05 | v1 | `POST /messages` com `Idempotency-Key` → aceito 1× e reconciliação | mesma chave com payload diferente → 409; provider ambíguo → `unknown_reconciling` sem reenvio cego | Intenção retida durante rollout; callbacks aceitam estados novos |
| C06 | v1 | upload ≤16MiB com magic bytes e scanner CLEAN → `stored` e leitura autorizada | >16MiB → 413; INFECTED/PENDING → indisponível; URL fora do bucket → negada | Assets antigos sem scan permanecem bloqueados até reprocesso |
| C07 | v1 | `GET /conversations?cursor=…` → página estável + `nextCursor` | cursor inválido → 400 `INVALID_CURSOR`; transição proibida → 409/403 | DTOs aditivos; UI tolera campos novos e ausentes |
| C08 | v1 (D03 OPEN) | `patients` 1:N atual; `privacy` dry-run e export escopado | ferramenta IA não aprovada → 403 `AI_POLICY_DENIED`; escopo divergente → 404 | N:N entra por expand/contract quando D03 for ratificada; 1:N mantido na transição |
| C09 | v1 | `/health` 200; `/readiness` 200 com DB+migrations+Redis | dependência crítica ausente → 503 com componente; `/metrics` sem token → 401 | Boot antigo continua aceito até o próximo deploy; probes novos são aditivos |
| C10 | v1 | manifesto com `commit`+`lockfileSha256`+`sourceSha256`+`image`+checks PASS atuais | SHA/lock/source divergentes, artefato vazio/velho, gate ausente/skipped → FAIL/BLOCKED/MISSING | Selo antigo nunca promove; novo manifesto é exigido por evento |

## Regras de mudança

Mudanças de contrato passam pelo integrador antes de tocar produtor e consumidor. Rollout compatível: aditivo primeiro, consumidores antes de remover campos; migrações de dados por expand/contract. Uma descrição nesta tabela não substitui a prova de produtor/consumidor no candidato.
