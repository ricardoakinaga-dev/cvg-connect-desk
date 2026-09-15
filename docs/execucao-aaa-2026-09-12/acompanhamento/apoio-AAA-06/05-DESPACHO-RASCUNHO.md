# AAA-06 — Minuta de despacho (para emissão pelo coordenador)

- ID: AAA-06 | Run proposto: `aaa-20260912-a6` | Base: `754f9badac46278e77d21de91c58eedb15e80581`.
- Responsável: **builder único frontend/infra** (atribuição a registrar em `ownership.json`; `apps/desk-web/**` ainda não tem dono ativo).
- Pré-condições: AAA-01 (C01 v1.0.2 `abd51f32…`) atendida; **C08/C08-AAA06 congelado** (`04-CONTRATO-C08-RECORTE.md`); locks `compose-topology`, `ports:AAA-06`, `isolated-db:AAA-06`; ambiente isolado do harness (`playwright.aaa.config.ts`) identificado.
- Proibido: `app.ts`, lockfile/manifests, schema/migrations, realtime-service, packages/realtime, Chat/Gateway (AAA-02/AAA-04), docs canônicos/runtime, `BACKLOG.json`, `.gauntlet*`.

## 1. Escopo de escrita (do cartão)

- `apps/desk-web/Dockerfile`
- `apps/desk-web/nginx.conf`
- `apps/desk-web/src/lib/realtime.ts`
- `apps/desk-web/src/__tests__/realtime.test.ts`
- `docker-compose.yml`
- `e2e/smoke/aaa-06-remote.spec.ts` (novo)

Fora do escopo (não alterar sem redistribuição): `apps/desk-web/vite.config.ts`, `docker-compose.dev.yml`, `docker-compose.staging.yml`, `.env.example`, `playwright.config.ts`.

## 2. Objetivo e reprodução negativa

Corrigir A05: imagem padrão com origem pública correta, `/ws` e `ws/wss` conforme protocolo; navegador remoto em HTTPS conecta sem localhost nem mixed content; reconexão mantém fluxo; override explícito funciona em dev; token nunca em URL/log.

Antes de alterar código:
1. `pnpm --filter @cvg/desk-web exec vite build` sem `VITE_REALTIME_URL` → `grep -R "ws://localhost:8080" apps/desk-web/dist` encontra o literal (defeito).
2. Servir o `dist` e abrir de origem remota/HTTPS (harness) → tentativa a `ws://localhost:8080`/mixed content; sem eventos; reconexão inútil.

## 3. Implementação exigida

1. `realtime.ts`: `resolveRealtimeUrl` com precedência `baseUrl` → `VITE_REALTIME_URL` (absoluto ou path) → mesma origem `/ws/` (dev: `ws://localhost:8080`); `wss` quando `location.protocol === 'https:'`; sem token em URL/log.
2. `Dockerfile`: `ARG VITE_REALTIME_URL=/ws/` (remover default loopback).
3. `docker-compose.yml` (base): `VITE_REALTIME_URL: /ws/` em `desk-web.build.args`.
4. `nginx.conf`: manter `location /ws/` para `realtime-service:8080` (compatível); hardening opcional (`proxy_buffering off`).
5. Decisão registrada do coordenador sobre o lock (`Dockerfile:14 --no-lockfile`): corrigir no cartão ou waiver explícito (AAA-14/C08).

## 4. Testes e evidência

- Unitários U1–U8 e e2e E1–E5 de `03-TESTES.md` (exit codes e logs sanitizados).
- Regressão: `pnpm --filter @cvg/desk-web test`, `pnpm --filter @cvg/desk-web run typecheck` e `lint`; smoke original intacto.
- Negativo antes/depois com hashes; manifesto ligado a C02/C08-AAA06; limitação explícita se a imagem não puder ser construída (Docker negado).

## 5. Critérios de aceite

- CA1–CA6 de `03-TESTES.md` §5.
- Nenhuma regressão de dev (`DEV`) e dos testes atuais; sem mixed content; sem `localhost` no bundle; `/ws/` encaminhado; reconexão preservada.
- Não alterar contratos congelados; sem DDL/serviços.

## 6. Retorno exigido

IMPLEMENTED/BLOCKED/FAILED (nunca DONE), com candidato (diff + SHA-256), antes/depois, comandos/exits, limitações e riscos. Revisão independente, integração e reteste são do coordenador.
