# THREAT_MODEL — CVG Connect Desk (STRIDE, resumo operacional)

Fronteiras: internet → proxy → desk-web/desk-api; gateway↔Evolution; Secretary;
Redis; Postgres; workers; WebSocket.

| # | Ameaça | Caminho | Mitigação | Verificação |
|---|---|---|---|---|
| T1 | Webhook forjado (spoofing) | `POST /webhook/inbound`, `/gateway/*` | HMAC raw-body + anti-replay + fail-secure | `webhook-*.test.ts`, k6 burst |
| T2 | Replay de webhook | mesmo | timestamp skew + event-ID persistente (409) | testes anti-replay (8) |
| T3 | Roubo de sessão | `Authorization` vazado em log/DB | hash SHA-256, redaction, idle+absoluto, rotate/revoke | `auth-routes.*`, `redact*` |
| T4 | Credencial default | seed/docs | bootstrap fail-secure, sem default | `seed.ts`, migração, docs |
| T5 | IDOR / acesso cross-setor | `/sectors/:id/*`, `/conversations?sectorId` | `authorize()` + `requireSectorAccess` + default-deny | `sector-authz.*` (negativos) |
| T6 | Privesc via RBAC | roles/permissões | allowlist por rota, `SENSITIVE_ACTIONS`, audit | `authorize.test.ts` |
| T7 | SSRF via mídia | `mediaUrl` inbound/outbound | allowlist MIME, size cap, host denylist, sem creds na URL | `media-policy.test.ts` |
| T8 | Mídia maliciosa gigante | base64 no banco | data-URL sizing (16MB), `bodyLimit` 1MB | idem |
| T9 | DoS / força bruta | login, webhook | rate-limit segmentado, `skipOnError=false`, 429 metricado | k6 (429 observado) |
| T10 | Injection (SQL) | repositórios | Drizzle parametrizado, sem `sql.raw` | auditoria estática |
| T11 | XSS | desk-web | sem `dangerouslySetInnerHTML`, headers nginx | grep + headers |
| T12 | Perda/duplicação de mensagem | crash/retry | idempotência inbound+outbound, lease+ACK, reconciliação | `*-idempotency.*`, `resilience.*` |
| T13 | IA com excesso de autoridade | Secretary | policy layer deny-by-default + budgets + decision log | `ai-policy.test.ts` |
| T14 | Vazamento PII em logs | todos os runtimes | redaction + mask + pino redact paths | `observability.test.ts` |
| T15 | Supply chain | deps, imagens | CodeQL, gitleaks, trivy, audit, SBOM, pinagens | workflows + `pnpm audit` |
| T16 | Perda de dados (DR) | PG | backup+checksum+retenção, restore validado | scripts (restore E2E pendente) |
| T17 | DLQ volátil | restart do worker | DLQ persistente + claim atômico + replay auditado | `persistent-dead-letter*` (16) |
| T18 | Mídia infectada/vazada | anexos inbound | scan/quarentena, CLEAN gate, presigned exíproco | `media-pipeline` + ClamAV tests |
| T19 | Abuso de IA | tools da Secretary | registry 5 classes + aprovação humana persistente | `ai-tools` (6) |
| T20 | Exposição em realtime multirréplica | bus Redis | canal interno, sem PII nova, dedup | `realtime-fanout` (2) |

Riscos residuais: mídia sem object storage/scan; realtime em memória (single-replica);
DLQ em memória; sem OTEL SDK. Ver `TRIPLE_AAA_CERTIFICATION.md`.
