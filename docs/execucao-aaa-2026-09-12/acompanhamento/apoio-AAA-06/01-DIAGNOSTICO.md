# AAA-06 — Diagnóstico: URL de realtime no desenvolvimento, build e proxy

Base: `754f9badac46278e77d21de91c58eedb15e80581`. Hashes em `hashes-baseline.txt`.

## 1. Rastreamento da URL

| Etapa | Arquivo:linha | Comportamento |
|---|---|---|
| Construção do cliente | `apps/desk-web/src/lib/realtime.ts:64` | `this.url = options.baseUrl \|\| import.meta.env.VITE_REALTIME_URL \|\| 'ws://localhost:8080'` |
| Uso | `Inbox.tsx:77` | `realtimeClient.connect(token)`; auth via **mensagem** (`realtime.ts:140`), não na URL |
| Log | `realtime.ts:97` | `[Realtime] Connecting to <url>` (sem token) |
| Tipo de env | `vite-env.d.ts:5` | `VITE_REALTIME_URL?: string` |
| Dev (Vite) | `vite.config.ts:9-16` | proxy **apenas** `/api`; sem `/ws`; env do `.env` (`.env.example:128` → `ws://localhost:8080`) |
| Dev (Compose) | `docker-compose.dev.yml:88-89` | `VITE_API_URL: /api` e `DOCKER: "true"`; **sem** `VITE_REALTIME_URL` → fallback do código |
| Build da imagem | `Dockerfile:7-8` | `ARG VITE_REALTIME_URL=ws://localhost:8080` + `ENV` |
| Build da imagem | `Dockerfile:19` | `vite build` inlina `import.meta.env.VITE_REALTIME_URL` no bundle |
| Compose base | `docker-compose.yml:99-106` | build args só `VITE_API_URL: /api`; porta `80:80` |
| Compose staging | `docker-compose.staging.yml:213-221` | idem; porta `4174:80` |
| Nginx | `nginx.conf:61-72` | `location /ws/ { proxy_pass http://realtime-service:8080/; Upgrade/Connection; X-Forwarded-Proto }` |
| Realtime | `apps/realtime-service/src/index.ts:72` | `new WebSocketServer({ port })` — **path-agnostic** (aceita `/` após o strip do prefixo) |
| Rede | `docker-compose.yml:161-199` | `realtime-service` em `internal` + `frontend`; exposto só em `127.0.0.1:8080` |
| E2E/smoke | `playwright.config.ts:30-32`, `e2e/support/start-e2e-stack.ts:14-15` | injetam `VITE_REALTIME_URL=ws://localhost:4930` no dev server (ok para smoke local) |

## 2. Onde `localhost`/protocolo errado chegam ao navegador

1. **Imagem padrão (produção/staging):** o Compose não passa `VITE_REALTIME_URL`; o `ARG` default `ws://localhost:8080` do `Dockerfile:7` é inlinado no bundle por `vite build`. O navegador remoto resolve `localhost` para a **própria máquina** → conexão recusada. (Achado A05.)
2. **HTTPS → mixed content:** mesmo que o host remoto tivesse um realtime em 8080, a página `https://…` abrindo `ws://…` é bloqueada como mixed content; o correto é `wss://`.
3. **Dev remoto:** `VITE_REALTIME_URL` não é definido nos composes de dev; o fallback `ws://localhost:8080` só funciona na mesma máquina; o proxy Vite não cobre `/ws`.
4. **Proxy existente não utilizado:** `location /ws/` no nginx está correto e o `realtime-service` é path-agnostic, porém nada aponta o cliente para `/ws/`. O caminho proxy→serviço é compatível: `/ws/` é removido pelo `proxy_pass` com barra final e o servidor aceita `/`.
5. **Sem quebra de auth:** o token vai por mensagem (`realtime.ts:140`); nenhum teste atual garante que ele nunca vá para a URL — deve entrar no aceite.

## 3. Evidências (estáticas; nada foi executado em imagem/serviço)

- Hashes dos 12 arquivos: `hashes-baseline.txt`.
- Grep de defaults: `Dockerfile:7` e `realtime.ts:64` (acima).
- Não houve build de imagem nesta preparação (Docker negado no host; alternativa aceita por D04). Proposta de verificação em `03-TESTES.md`.

## 4. Reprodução negativa proposta (para o despacho)

1. `pnpm --filter @cvg/desk-web exec vite build` com `VITE_REALTIME_URL` ausente → `grep -R "ws://localhost:8080" apps/desk-web/dist` encontra o literal (defeito atual; confirmação estática).
2. Construir/servir e abrir de um segundo host (ou `https://` local com TLS) → console acusa tentativa a `ws://localhost` e/ou bloqueio de mixed content; realtime sem eventos.
3. Com a correção: mesmo build sem env → bundle sem `localhost`; conexão a `ws(s)://<host>/ws/`; conexão remota recebe eventos; reconexão mantém fluxo.
