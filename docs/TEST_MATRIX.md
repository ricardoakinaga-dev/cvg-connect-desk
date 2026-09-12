# TEST MATRIX — CVG Connect Desk

Estados: `VERIFIED` (teste/gate executado com evidência) · `PARTIAL` (parcial/CI-externo) · `NOT_TESTED`.

| Área | Requisito | Teste/Gate | Evidência | Status |
|---|---|---|---|---|
| Auth | login/logout/me/rotate/logout-all | `auth-routes` (6) | gate local | VERIFIED |
| Auth | tokens só hash, idle+absoluto | integração + migration 0013 | `db:check` | VERIFIED |
| Webhook | HMAC raw-body | `webhook-guard` (12) + inbound (8) | gate | VERIFIED |
| Webhook | anti-replay (8 cenários) | guard + inbound + stats | gate | VERIFIED |
| RBAC | `authorize()` central + negativos | `authorize` (9) + `sector-authz` (9) | gate | VERIFIED |
| Setores | escopo + default-deny + override | `sector-authz` (9) | gate | VERIFIED |
| Inbound | idempotência + canonical ID | `receive-inbound-idempotency` (6) | postgres-real | VERIFIED |
| Outbound | idempotência + reconciliação + pipeline EICAR | `outbound-idempotency` (8) | gate | VERIFIED |
| Outbox | fan-out, lease+ACK, redelivery, malformed | events (148) + `events-polling` + `resilience` (5) | gate/pg-real | VERIFIED |
| Contratos | gateway→chat via zod | `gateway-contracts` (4) + `contracts` (7) | gate | VERIFIED |
| Retry | classificação/backoff/Retry-After | `retry-policy` (13) | gate | VERIFIED |
| Gateway | retry bounded + caos 500/reset/429 | `provider-chaos` (4) | gate | VERIFIED |
| Mídia | MIME/size/SSRF/sha256 | `media-policy` (6) + outbound 400s | gate | VERIFIED |
| Storage | S3/memory drivers + quarentena | `media-pipeline` (12) + `s3-storage` (8) | gate | VERIFIED |
| Malware | clean/infected/timeout/unavailable | `media-pipeline` (ClamAV fake server) | gate | VERIFIED |
| IA | policy deny-by-default + budgets | `ai-policy` (6) | gate | VERIFIED |
| IA tools | 5 classes + approval flow | `ai-tools` (6) | gate | VERIFIED |
| Observabilidade | redaction + métricas + `/metrics` | `observability` (8) + `metrics` (2) | gate | VERIFIED |
| Tracing | propagação/child/erro/correlação | `tracing` (7) | gate | VERIFIED |
| Realtime | backoff/heartbeat/stale/pong | web `realtime` (9) + service (72) | gate | VERIFIED |
| Realtime multi | bus A↔B + fanout 2-nós + dedup | `realtime-bus` (4) + `realtime-fanout` (2) | gate (Redis real) | VERIFIED |
| Frontend | páginas + store + api-client | 7 arquivos (45) | gate | VERIFIED |
| DLQ persistente | 11 repo + 5 API | `persistent-dead-letter*` (16) | gate (PG real) | VERIFIED |
| LGPD | export/anonymize + API + audit | privacy (4) + `privacy-dsar` (3) | gate | VERIFIED |
| DB | migrations fresh + constraints | `db:check` (37 tabelas) + `schema` (27) | gate | VERIFIED |
| Deps críticas | 0 critical | `pnpm audit --audit-level=critical` | gate | VERIFIED |
| HIGHs | triage formal | `SECURITY_VULNERABILITY_TRIAGE.md` | 0 critical, 27 triadas | VERIFIED |
| Carga | 10→50 VUs + burst assinado | `e2e/load/smoke-load.js` | 100%, p95 12,7ms@50VUs | VERIFIED |
| Caos | 10 cenários, nenhum silêncio | `resilience` + `provider-chaos` + bus/redis-down | gate | VERIFIED |
| Coverage gate | shared ≥85/80/85/85 | vitest `--coverage` | 94.6/87.8/94.9/94.6 | VERIFIED |
| Mutação | 3 mutantes críticos mortos | experimento manual | 3/3 killed | VERIFIED |
| SAST/secrets/container/SBOM | CodeQL, gitleaks, trivy, SBOM | workflows | CI (não executado aqui) | PARTIAL |
| E2E browser | smoke | playwright `smoke-e2e.yml` | CI | PARTIAL |
| DR E2E | backup→restore→smoke | `dr-e2e.sh` + workflow | CI (sintaxe OK) | PARTIAL |

Totais finais (`turbo run test --force`, PG+Redis reais): **87 arquivos · 733 testes · 0 falhas**.
ESLint web: 0 errors. `tsc`: pass. Build: pass. Master gate: `pnpm triple-aaa:verify` → VERIFIED_CANDIDATE.
