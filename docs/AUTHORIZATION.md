# AUTHORIZATION — CVG Connect Desk

## Modelo (§7.1)

RBAC (roles → permissões) **+** escopo de setor (memberships) **+** override de admin global.

API central (`@cvg/auth`, `authorize.ts`):

```ts
authorize(actor, action, resource?, context?) → { allowed, reason }
```

- `reason`: `unauthenticated` | `global-admin` | `missing-permission` | `sector-allowed` | `sector-denied` | `permitted`.
- Role `Admin` (ou flag DB via `isGlobalAdmin`) = override total.
- Com `sectorId` no recurso/contexto e sem override: exige membership com nível (`:read`→`read`, demais→`write`).

## Ações sensíveis (§7.3)

`SENSITIVE_ACTIONS` (`admin.permission.change`, `contact.delete`, `dlq.replay`, `message.resend`, `session.revoke`, `sector.membership.change`, `ai.privileged`, …) — todas exigem permissão explícita **e** geram audit log.

## Enforcement HTTP

- `requirePermission(...)` / `requireRole(...)` (existentes) + `requireSectorAccess(resolve, level)` (novo) — 401 sem usuário, 400 sem setor, 403 sem membership.
- Aplicado em: `/sectors/:id/conversations`, `/sectors/:id/stats`, filtro `?sectorId` em `/conversations`.
- `GET /conversations` com **default-deny**: não-admin sem setores recebe `[]` (antes via tudo).

## Testes

- `packages/auth/src/__tests__/authorize.test.ts` (9 casos, com negativos).
- `apps/desk-api/src/__tests__/sector-authz.integration.test.ts` (8 casos: membro/não-membro/admin, lista com escopo, audit de membership).
