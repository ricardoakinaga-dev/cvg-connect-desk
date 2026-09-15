# AAA-06 — Solução proposta (origem pública, `/ws`, `ws/wss`)

Nada foi aplicado. Diffs são proposta para o despacho.

## 1. Princípio

Resolver a URL em **runtime, no navegador**, com precedência explícita:

1. `options.baseUrl` (testes/injeção) — preservado;
2. `import.meta.env.VITE_REALTIME_URL` quando definido:
   - valor **absoluto** (`ws://…`/`wss://…`) → usado como está (override explícito);
   - valor em **path** (`/ws/`) → resolvido para a mesma origem com protocolo da página;
3. sem configuração:
   - **produção**: mesma origem `ws(s)://<host>/ws/` (origem pública + proxy nginx);
   - **dev**: mantém `ws://localhost:8080` (compatibilidade; evita exigir proxy `/ws` no Vite, cujo `vite.config.ts` não está no escopo do cartão).

Assim a imagem padrão não inlina mais `localhost`, funciona de qualquer host e escolhe `wss` em HTTPS.

## 2. Diff proposto — `apps/desk-web/src/lib/realtime.ts`

```diff
+export interface RealtimeUrlLocation { protocol: string; host: string }
+export interface RealtimeUrlContext {
+  baseUrl?: string;
+  envUrl?: string;
+  location?: RealtimeUrlLocation | null;
+  dev?: boolean;
+}
+
+function sameOrigin(path: string, location?: RealtimeUrlLocation | null): string {
+  const loc = location ?? (typeof window !== 'undefined' ? window.location : null);
+  if (!loc?.host) return 'ws://localhost:8080'; // fora do navegador (SSR/testes sem host)
+  const scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:';
+  return `${scheme}//${loc.host}${path.startsWith('/') ? path : `/${path}`}`;
+}
+
+/** Precedência: baseUrl → env (absoluto/path) → mesma origem `/ws/` (dev: localhost:8080). */
+export function resolveRealtimeUrl(ctx: RealtimeUrlContext = {}): string {
+  if (ctx.baseUrl) return ctx.baseUrl;
+  const configured = ctx.envUrl?.trim();
+  if (configured) {
+    return configured.startsWith('/') ? sameOrigin(configured, ctx.location) : configured;
+  }
+  return ctx.dev ? 'ws://localhost:8080' : sameOrigin('/ws/', ctx.location);
+}
+
 // construtor
-    this.url = options.baseUrl || import.meta.env.VITE_REALTIME_URL || 'ws://localhost:8080';
+    this.url = resolveRealtimeUrl({
+      baseUrl: options.baseUrl,
+      envUrl: import.meta.env.VITE_REALTIME_URL,
+      location: typeof window !== 'undefined' ? window.location : null,
+      dev: import.meta.env.DEV,
+    });
```

- `RealtimeClientOptions.baseUrl` continua tendo precedência máxima (testes atuais intactos).
- Nenhum token entra na URL (`sendAuth` continua por mensagem, `realtime.ts:140`); o log de conexão segue só com a URL.

## 3. Diff proposto — `apps/desk-web/Dockerfile`

```diff
-ARG VITE_REALTIME_URL=ws://localhost:8080
+ARG VITE_REALTIME_URL=/ws/
```
Mantém o override por argumento; o default vira o caminho de mesma origem. (A chamada `vite build` na linha 19 continua inlinando o valor — agora seguro.)

## 4. Diff proposto — `docker-compose.yml` (base)

```diff
   desk-web:
     build:
       context: .
       dockerfile: apps/desk-web/Dockerfile
       args:
         VITE_API_URL: /api
+        VITE_REALTIME_URL: /ws/
```
- **Compatibilidade:** com o novo default do Dockerfile, staging (fora do escopo de escrita) já passa a usar `/ws/` mesmo sem o arg; o arg explícito no base documenta a intenção e sobrevive a mudanças de default.
- `docker-compose.dev.yml` fica intacto: `import.meta.env.DEV=true` preserva `ws://localhost:8080`.

## 5. Nginx (`apps/desk-web/nginx.conf`)

O bloco `location /ws/` (linhas 61-72) já é compatível: `proxy_pass http://realtime-service:8080/;` remove o prefixo e o `WebSocketServer({ port })` (`apps/realtime-service/src/index.ts:72`) aceita `/`. Melhorias opcionais propostas (sem obrigatoriedade):

```diff
     location /ws/ {
         proxy_pass http://realtime-service:8080/;
         proxy_http_version 1.1;
+        proxy_buffering off;
         proxy_set_header Upgrade $http_upgrade;
```
Se no futuro o cliente usar `/ws` sem barra, adicionar `location = /ws { return 308 /ws/; }` (fora do mínimo).

## 6. Compatibilidade e migração

| Consumidor | Impacto |
|---|---|
| Testes unitários existentes (`baseUrl`) | Sem mudança (precedência preservada) |
| Dev local (vite) | Sem mudança (`DEV` → `ws://localhost:8080`) |
| Imagem base/staging | Passa a usar `ws(s)://<host>/ws/`; funciona remoto/HTTPS |
| `.env.example` | Revisar comentário para documentar `/ws/` como opção de produção (fora do escopo de escrita) |
| Conexão direta a `127.0.0.1:8080` | Preservada para operação local; não é mais o default do browser |
| Tokens | Continuam só na mensagem de auth; sem query string |

## 7. Riscos residuais

- Se um proxy externo não encaminhar `/ws/` até o nginx do `desk-web`, o cliente falha; o documento de C08 propõe tornar isso requisito de plataforma verificável.
- `import.meta.env.DEV` é `false` no build de produção — correto para o alvo.
- Build reprodutível: o `Dockerfile:14` usa `pnpm install -r --no-lockfile` (achado A12/C08); a correção disso não pertence a AAA-06, mas deve ser explicitamente aceita ou tratada por C08/AAA-14 antes do aceite da imagem.
