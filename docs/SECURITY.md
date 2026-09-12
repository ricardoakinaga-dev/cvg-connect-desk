# SECURITY — CVG Connect Desk

## Autenticação

- Sessões opacas: token criptográfico (`uuid + 24 bytes`), persistido **apenas como SHA-256** (`sessions.token/token_hash`, migration 0013).
- Idle timeout 24h (`SESSION_IDLE_TIMEOUT_MS`), absoluto 30d, revogação lógica, rotação (`POST /auth/rotate`), `POST /auth/logout-all`.
- bcrypt (custo 10–12). Sem JWT.

## Webhooks

- HMAC-SHA256 sobre **raw bytes**: `X-Webhook-Signature: sha256=<hex>`, mensagem `timestamp.rawBody`.
- Anti-replay: `X-Webhook-Timestamp` (skew 300s) + `X-Webhook-Event-Id` persistido (409 em duplicata).
- Produção sem `WEBHOOK_SECRET` → 500 fail-secure. Validação de algoritmo/tamanho/hex sem throw.

## Bootstrap e segredos

- Produção exige `ADMIN_BOOTSTRAP_EMAIL` + `ADMIN_BOOTSTRAP_PASSWORD` (≥12 chars); sem eles, nenhum admin é criado. Nenhuma senha default em docs/código de produção.
- `.env` nunca commitado (verificado). Scans: gitleaks + CodeQL + Trivy + `pnpm audit` + SBOM no CI.

## Rede e HTTP

- CORS fail-secure (ausente/`*` derruba o boot em produção). Helmet + headers nginx.
- Rate limit segmentado: global 100/min, login 10/min, webhook 300/min, `skipOnError: false`.
- `bodyLimit` 1MB; mídia validada (MIME allowlist, 16MB, SSRF guard, data-URL sizing).

## Ler também

`THREAT_MODEL.md` (STRIDE), `AUTHORIZATION.md` (RBAC+setores), `AI_SAFETY.md`, `DISASTER_RECOVERY.md`.
