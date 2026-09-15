# AAA-06 — Testes necessários e critérios verificáveis

## 1. Unitários — `apps/desk-web/src/__tests__/realtime.test.ts` (estender)

O resolver puro `resolveRealtimeUrl({ baseUrl, envUrl, location, dev })` torna os casos determinísticos sem depender de `window` real.

| # | Caso | Entrada | Esperado |
|---|---|---|---|
| U1 | Origem remota HTTP | `{}` + `location={protocol:'http:',host:'desk.example:8080'}` + `dev:false` | `ws://desk.example:8080/ws/` |
| U2 | **HTTPS → WSS** | `location={protocol:'https:',host:'desk.example'}` + `dev:false` | `wss://desk.example/ws/` (sem mixed content) |
| U3 | Override absoluto | `envUrl='wss://rt.example/ws'` | valor literal, inalterado |
| U4 | Override em path | `envUrl='/custom/ws'`, `location` https | `wss://desk.example/custom/ws` |
| U5 | `baseUrl` vence env | `baseUrl='ws://realtime.test'`, `envUrl='wss://x'` | `ws://realtime.test` (testes existentes) |
| U6 | Dev sem env | `dev:true`, sem env | `ws://localhost:8080` (compatibilidade) |
| U7 | Sem `location` (não-browser) | `{}`, `dev:false`, sem location | não lança; fallback definido |
| U8 | **Token nunca na URL/log** | conectar com token; inspecionar `client.url` e chamadas do logger | nenhum `token`/JWT em URL ou log; auth só via `{type:'auth',token}` |

Testes existentes de reconexão/heartbeat devem continuar verdes (regressão da fronteira).

## 2. E2E — `e2e/smoke/aaa-06-remote.spec.ts` (TO_CREATE)

Objetivo: provar o comportamento de **origem remota e HTTPS** sem `localhost` e com `/ws` encaminhado.

| # | Caso | Montagem | Asserção |
|---|---|---|---|
| E1 | Origem remota HTTPS→WSS | `dist` servido em `https://127.0.0.1:<porta>` (cert self-signed; `ignoreHTTPSErrors`), nginx/TLS terminator encaminhando `/ws/` para mock WS | `page.addInitScript` captura `new WebSocket(url)`; a URL é `wss://127.0.0.1:<porta>/ws/`; nenhuma tentativa a `localhost`; sem erro de mixed content no console |
| E2 | Encaminhamento `/ws` pelo proxy | mesmo stack, mock WS atrás do terminator | o mock registra upgrade em `/` após strip do `/ws/`; HTTP 101 |
| E3 | Reconnect mantém fluxo | derrubar o mock WS e reativar | cliente reconecta (backoff) e reautentica; eventos voltam a chegar |
| E4 | Override explícito (dev) | `VITE_REALTIME_URL=ws://127.0.0.1:<mock>` (http) | conexão direta ao mock; comportamento do override |
| E5 | Sem `localhost` no bundle | `vite build` sem env | `grep` do `dist` sem `ws://localhost:8080` |

## 3. Harness e ambiente isolado necessários

- `playwright.aaa.config.ts` (criado por AAA-00) + stack isolada: web estática/TLS, mock WebSocket, proxy `/ws/` e rota `/api` (o login exige API — usar a stack isolada do harness com PG/Redis dedicados).
- Portas/locks do cartão: `ports:AAA-06`, `isolated-db:AAA-06`, `compose-topology` (se o teste subir compose/TLS local).
- Docker está negado no host (D04): usar terminator TLS local + `vite build`/`serve` como equivalente da imagem; registrar essa substituição e o que não foi provado (imagem publicada).
- Testes unitários rodam sem banco: `pnpm --filter @cvg/desk-web exec vitest run src/__tests__/realtime.test.ts` (check EXISTING do cartão).

## 4. Reprodução negativa antes/depois (obrigatória no despacho)

1. **Antes:** build sem `VITE_REALTIME_URL` → `grep -R "ws://localhost:8080" apps/desk-web/dist` encontra o literal; E1/E2 falham (URL `ws://localhost` ou mixed content).
2. **Depois:** mesmo build sem env → grep vazio; E1/E2/E3/E5 verdes; U1–U8 verdes.
3. Registrar exit codes e logs sanitizados; a imagem Docker não construída deve constar como limitação de ambiente.

## 5. Critérios de aceite verificáveis (para o despacho)

- CA1: `resolveRealtimeUrl` com `dev:false` retorna `ws(s)://<host>/ws/` conforme protocolo (U1/U2).
- CA2: override absoluto e path funcionam; `baseUrl` preserva testes (U3–U5/U6).
- CA3: bundle de produção sem `ws://localhost:8080` (E5 + grep).
- CA4: e2e remoto HTTPS conecta em `wss` e o proxy encaminha `/ws` (E1/E2); reconexão funciona (E3).
- CA5: token nunca em URL/log (U8).
- CA6: regressão: suíte web completa (`pnpm --filter @cvg/desk-web test`) e lint/typecheck da web verdes; smoke original não afetado.
