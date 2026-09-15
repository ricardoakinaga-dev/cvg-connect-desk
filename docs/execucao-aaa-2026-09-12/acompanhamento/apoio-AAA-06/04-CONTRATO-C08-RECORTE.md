# AAA-06 — Recorte contratual de C08 (proposta para revisão do coordenador)

## 1. Situação

- O cartão AAA-06 declara contratos **C02 e C08**. C02 está congelado (`runtime/contracts/C02.md`, `b96ebc6002…`).
- **C08 não existe em `runtime/contracts/`** (há apenas C01, C02, C03). Em `CONTRATOS.md`, C08 é "especificação alvo" (dono: Plataforma/SRE; runtime/lock fixados, contrato de build/lint/typecheck/test, readiness 503, metrics, proveniência).
- O despacho de AAA-06 exige "contratos vigentes"; sem o recorte abaixo congelado, a implementação fica bloqueada (a preparação, não).

## 2. O que AAA-06 precisa de C08 (recorte mínimo `C08-AAA06`)

1. **Configuração de build × runtime da imagem web**
   - `VITE_*` são substituídos em **build**; o default da imagem **não pode** referenciar loopback.
   - Valores de runtime (nginx/compose) e de build (args) têm dono e registro; mudança de arg é mudança de artefato (hash/digest).
2. **Origem pública e ingresso**
   - A URL do realtime deriva da **origem da página** por padrão: `ws(s)://<host>/ws/` (protocolo pela página; sem mixed content).
   - `/ws/` é o caminho canônico de ingresso no nginx do `desk-web`; terminação TLS é do proxy externo, que deve encaminhar `/ws/` e `Upgrade`/`Connection`.
   - Exposição direta `127.0.0.1:8080` do realtime é local-only.
3. **Reprodutibilidade e proveniência**
   - Lockfile congelado e instalação reprodutível no build da imagem; **hoje `Dockerfile:14` usa `pnpm install -r --no-lockfile`** (violação A12/C08) — o coordenador decide: corrigir neste cartão (Dockerfile está no escopo) ou waiver explícito apontando AAA-14.
   - Evidência: hashes dos fontes, args de build, `grep` do bundle, digest da imagem quando houver build; ambiente/versões registrados (divergência Node 20/24 de D04).
4. **Verificação**
   - Bundle de produção sem `ws://localhost:8080`; testes unitários de resolução e e2e de origem remota HTTPS→WSS e proxy (ver `03-TESTES.md`).

## 3. Matriz semântica do recorte (checklist de AAA-01)

| Campo | Definição |
|---|---|
| Produtor | `apps/desk-web` (cliente realtime) + `Dockerfile`/`docker-compose.yml`/`nginx.conf` (imagem e ingresso) |
| Consumidores | navegador do operador (remoto/HTTPS), proxy externo de TLS, `apps/realtime-service` atrás de `/ws/` |
| Assinatura alvo | `resolveRealtimeUrl({baseUrl?, envUrl?, location?, dev?}) → string`; precedência `baseUrl` → env absoluto/path → mesma origem `/ws/` (dev: `localhost:8080`) |
| Exemplo aceito | página `https://desk.example` sem env → `wss://desk.example/ws/`; conexão recebe eventos |
| Exemplo rejeitado | bundle com `ws://localhost:8080`; página HTTPS tentando `ws://`; `/ws/` não encaminhado (sem upgrade) |
| Política de erro | sem configuração e sem `location` → fallback explícito, sem lançar; reconexão com backoff continua; token nunca em URL/log |
| Teste de consumidor | `realtime.test.ts` (U1–U8) + `e2e/smoke/aaa-06-remote.spec.ts` (E1–E5) |
| Compatibilidade | `baseUrl` e dev local preservados; `docker-compose.dev.yml`, `vite.config.ts` e compose de staging fora do escopo (staging herda o novo default do Dockerfile) |
| Versão | `C08-AAA06` v1.0.0 proposta (congelamento pelo coordenador) |
| Decisão pendente | (a) lock congelado no build da imagem: corrigir agora × waiver para AAA-14; (b) arg explícito no compose de staging; (c) dono do proxy TLS externo que encaminha `/ws/` |

## 4. Ação solicitada ao coordenador

1. Revisar/congelar `C08-AAA06` (ou o C08 completo) em `runtime/contracts/`, com hashes e decisões (a)–(c).
2. Registrar a redistribuição de ownership de `apps/desk-web/**` e `docker-compose.yml` para o builder único de AAA-06.
3. Emitir o despacho (`05-DESPACHO-RASCUNHO.md`) com o recorte acima referenciado.
