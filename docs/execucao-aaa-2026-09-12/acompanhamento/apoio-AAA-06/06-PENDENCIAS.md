# AAA-06 — Pendências exatas para implementar

1. **C08 ausente** — congelar `C08-AAA06` (recorte de `04-CONTRATO-C08-RECORTE.md`) em `runtime/contracts/`, com hashes e decisões pendentes:
   - (a) `Dockerfile:14` usa `pnpm install -r --no-lockfile` (viola lock/reprodutibilidade): corrigir no escopo de AAA-06 (Dockerfile está na lista) ou waiver formal para AAA-14/C08;
   - (b) `docker-compose.staging.yml` não passa `VITE_REALTIME_URL` (herda o novo default `/ws/`; decidir se exige arg explícito — arquivo fora do escopo);
   - (c) dono do proxy TLS externo que encaminha `/ws/` e `Upgrade` (plataforma/SRE) e evidência de encaminhamento.
2. **Despacho e ownership** — emitir `runtime/dispatch/AAA-06.md` com builder único e escopo exclusivo (`apps/desk-web/**`, `docker-compose.yml`, `e2e/smoke/aaa-06-remote.spec.ts`) e locks `compose-topology`, `ports:AAA-06`, `isolated-db:AAA-06`; hoje `ownership.json` não atribui `apps/desk-web/**`.
3. **Ambiente isolado** — definir run/portas do AAA-06 (ports:AAA-06) e confirmar `playwright.aaa.config.ts`/harness AAA-00 para o e2e; sem banco dedicado obrigatório para o teste de URL, mas login exige API (stack isolada).
4. **Decisão de escopo de dev** — manter `import.meta.env.DEV → ws://localhost:8080` (proposto) ou autorizar alterar `vite.config.ts`/`docker-compose.dev.yml` para proxy `/ws` (redistribuição necessária).
5. **`.env.example`** — comentário/doc de `VITE_REALTIME_URL` desatualizado para produção (`ws://localhost:8080`); fora do escopo de escrita — incluir em follow-up de docs.
6. **Imagem** — Docker negado no host (D04); o aceite da "imagem padrão" será por equivalente (`vite build` + serve/TLS local), com limitação registrada; se o coordenador exigir imagem real, indicar host/ambiente com Docker.
7. **Não tocar** — `apps/desk-web/vite.config.ts`, composes dev/staging, `playwright.config.ts`, runtime/contratos canônicos, arquivos de AAA-04 (em correção pelo outro builder).
