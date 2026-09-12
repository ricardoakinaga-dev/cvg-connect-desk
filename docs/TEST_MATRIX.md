# TEST MATRIX — CVG Connect Desk

Estados: `VERIFIED` (teste/gate executado com evidência) · `PARTIAL` (parcial/manual) · `NOT_TESTED`.

| Área | Requisito | Teste/Gate | Evidência | Status |
|---|---|---|---|---|
| Auth | login/logout/me/rotate/logout-all | `auth-routes.integration` (6) | turbo 28/28 | VERIFIED |
| Auth | tokens só hash, idle+absoluto | integração + migration 0013 | `db:check`, testes | VERIFIED |
| Webhook | HMAC raw-body | `webhook-guard` (12) + inbound (8) | turbo | VERIFIED |
| Webhook | anti-replay (old/future/dup/sem ts/sem id/malformed) | guard + inbound + stats | turbo | VERIFIED |
| RBAC | `authorize()` central + negativos | `authorize` (9) + `sector-authz` (8) | turbo | VERIFIED |
| Setores | escopo + default-deny + override admin | `sector-authz` (8) | turbo | VERIFIED |
| Mensageria | idempotência inbound | `receive-inbound-idempotency` (6) | postgres-real | VERIFIED |
| Mensageria | idempotência outbound + reconciliação | `outbound-idempotency` (7) | turbo | VERIFIED |
| Outbox | fan-out, lease+ACK, redelivery, malformed | `outbox-*` (133 eventos) + `events-polling` + `resilience` (5) | turbo/pg-real | VERIFIED |
| Contratos | gateway→chat via zod | `gateway-contracts` (4) + `contracts` (7) | turbo | VERIFIED |
| Retry | classificação/backoff/Retry-After | `retry-policy` (13) | turbo | VERIFIED |
| Gateway | contract + retry bounded | contracts + `gatewayService` | turbo | VERIFIED |
| Mídia | MIME/size/SSRF/sha256 | `media-policy` (6) + outbound 400 (2) | turbo | VERIFIED |
| IA | policy deny-by-default + budgets | `ai-policy` (6) | turbo | VERIFIED |
| Observabilidade | redaction + métricas + `/metrics` | `observability` (8→) + `metrics` (2) | turbo | VERIFIED |
| Realtime | backoff/heartbeat/stale/pong | web `realtime` (9) + service (70) | turbo | VERIFIED |
| Frontend | páginas + store + api-client | 7 arquivos (45) | turbo | VERIFIED |
| DB | migrations fresh + constraints | `db:check` (34 tabelas) + `schema` (27) | local+CI | VERIFIED |
| Segurança deps | 0 critical | `pnpm audit --audit-level=critical` | 0 critical | VERIFIED |
| SAST/secrets/container/SBOM | CodeQL, gitleaks, trivy, SBOM | workflows `security.yml` | CI (não executado aqui) | PARTIAL |
| Carga | smoke 10VUs + burst assinado | `e2e/load/smoke-load.js` | 100% checks, p95 6,7ms | VERIFIED |
| Caos | fallback sem Secretary, degraded, crash worker | `resilience` (5) | turbo | VERIFIED |
| E2E browser | smoke login/inbox/kanban/task | playwright `smoke-e2e.yml` | CI (não executado aqui) | PARTIAL |
| Backup/restore | scripts + validação | `pg-backup/restore.sh` | syntax-check (restore E2E pendente) | PARTIAL |
| OTEL tracing | SDK distribuído | — | decisão: métricas in-process | NOT_TESTED |
| S3 mídia / malware scan | storage externo | — | lacuna documentada | NOT_TESTED |
| Mutação | componentes críticos | — | custo/benefício pendente | NOT_TESTED |
| LGPD export/delete | DSAR tooling | redaction + retention docs | parcial | PARTIAL |
| `pnpm test` (turbo) | env propagation | `globalPassThroughEnv` | 28/28, 76 arquivos, 665 testes | VERIFIED |

Totais finais (turbo `--force`): **28 tasks OK · 76 arquivos · 665 testes · 0 falhas**.
ESLint web: 0 errors. `tsc` web: pass. Build web: pass. k6: thresholds verdes.
