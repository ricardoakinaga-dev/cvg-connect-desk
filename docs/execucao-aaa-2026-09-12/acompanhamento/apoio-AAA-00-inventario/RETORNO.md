# RETORNO — pacote documental de apoio AAA-00 (inventário e matriz)

- Run: `apoio-AAA-00-inventario`.
- Data/hora do fechamento: 2026-09-12 (UTC registrado nos snapshots).
- HEAD de referência: `754f9badac46278e77d21de91c58eedb15e80581` (branch `main`, sem commit candidato).
- **Nada foi executado como validação**: sem suítes, builds, migrations, provisionamento, instalação ou uso de banco. Todas as classificações são estáticas.
- **AAA-00 não está DONE.** Este pacote cobre apenas dois entregáveis documentais pendentes (inventário de checks e matriz de serviços) e não implementa fixtures, benchmark ou isolamento.

## 1. Arquivos produzidos (neste diretório)

| Arquivo | SHA-256 |
|---|---|
| `INVENTARIO_CHECKS.md` | `d72a90d79c7909db891e28855758335a955b6d3d7fd3d4baa1a7b509a18e4c14` |
| `MATRIZ_SERVICOS.md` | `ff97ea76924f9040920d27b2ffe88c4dc75b9f2f67c794d1bff742d62bce178e` |
| `RETORNO.md` | hash calculado após o fechamento (não autorreferenciado aqui) |
| `fontes-hashes-inicio.txt` | 46 fontes determinantes no início da análise |
| `fontes-hashes-fim.txt` | mesmas 46 fontes ao final |

Nenhum outro diretório foi escrito. O diretório atribuído não continha trabalho de outro responsável; por isso os arquivos foram gravados diretamente nele, sem subdiretório de run.

## 2. Fontes determinantes consultadas

- Instruções e catálogo: `tasks/AAA-00.md`, `BACKLOG.json` (checks declarados), `QUALIDADE.json`, `runtime/state.json`, `runtime/dispatch/*`, `runtime/contracts/C02.md` e `C03.md`.
- Manifests e orquestração: `package.json` (raiz + 33 workspaces), `turbo.json`, `pnpm-workspace.yaml`.
- Testes e configs: `vitest.config.ts` (raiz + 34 específicos), `playwright.config.ts`, `playwright.aaa.config.ts`, todos os arquivos de teste do repositório (117 `.test`/`.spec`, sem `node_modules`).
- CI: 8 workflows em `.github/workflows/`, `.github/scripts/certification-aggregator.mjs`.
- Scripts: `scripts/{triple-aaa-verify,production-readiness,staging-smoke,otel-e2e-check,capture-design}.mjs`; `infra/scripts/{dr-e2e.sh,query-performance.mjs,pg-backup.sh,pg-restore.sh,make_packages.mjs}`.
- Infra/empacotamento: 3 Dockerfiles, `docker-compose*.yml`, `.env.example`.
- Harness AAA: `e2e/support/start-e2e-stack.ts`, `mock-evolution-server.ts` e `e2e/support/aaa/*`; `e2e/aaa/*`; `e2e/smoke/support.ts`.
- Código de fronteira: `packages/database/src/{client,index}.ts`, `drizzle.config.ts`, `apps/desk-api/src/app.ts`, `packages/media/src/{index,scanner,s3-storage}.ts`, `packages/tracing/src/index.ts`, `modules/gateway-adapter/src/infrastructure/*`, `packages/integrations/src/secretary-client.ts`.

## 3. Comandos de inspeção executados e resultado

| Comando (leitura/busca) | Resultado observado |
|---|---|
| `git rev-parse HEAD` e `git status --porcelain` | HEAD `754f9ba`; worktree com código de AAA-02/03 em andamento e artefatos do programa (não alterados por esta tarefa) |
| Parser dos `package.json` dos 33 workspaces | 1 lint real, 6 build reais, 6 typecheck reais, 33 test reais (27 com `--passWithNoTests`) |
| Contagem de arquivos de teste (excl. `node_modules`) | 117 arquivos `.test.ts/.tsx/.spec.ts` |
| `grep -rn DATABASE_URL` em apps/packages/modules/e2e/scripts/infra | 11 pontos relevantes de fallback/default (tabela §2 da matriz) |
| `grep -rn REDIS_URL` | fallback 6379 em 3 testes; uso opcional em `app.ts:275` e `realtime/index.ts:67` |
| `grep -rnE "\.delete\(|DELETE FROM|TRUNCATE|DROP..."` | padrões de limpeza por teste + `DROP DATABASE` no DR e no `down -v` do smoke |
| `grep -rn "STAGING_SMOKE|S3_|CLAMAV|MALWARE_SCANNER|MEDIA_|OTEL_"` | MinIO/ClamAV/OTel reais só em staging; mocks nos demais |
| Leitura dos 8 workflows | serviços por job mapeados (postgres/redis/minio/clamav/otel) |
| Leitura de Dockerfiles | `pnpm install -r --no-lockfile`; `tsc --noEmit || true` em `apps/desk-api/Dockerfile` |
| Verificação de arquivos propostos | ausentes: `e2e/aaa/accessibility.spec.ts`, `e2e/aaa/visual.spec.ts`, `e2e/aaa/performance.spec.ts`, `infra/scripts/aaa-load.mjs` |
| `sha256sum` das 46 fontes no início e no fim + comparação | **0 de 46 fontes mudaram** durante a entrega; não houve divergência a reconciliar |

## 4. Lacunas (fatos não determinados)

1. **Nada foi executado** — por instrução, não há PASS. O inventário não confirma se os checks passam, se o ciclo de dependências foi eliminado pelo AAA-02 nem se as suítes de DB fecham.
2. **Critérios QA sem nome inline**: `QUALIDADE.json` lista QA01–QA18, mas o mapeamento check→critério não é legível só desse arquivo; a matriz usa o grupo de serviço, não a nota/área.
3. **Fallbacks silenciosos para 5432/6379** permanecem em `test:postgres-real`, outbox/chat e realtime; sem `DATABASE_URL`, uma suíte pode atingir banco local errado. O guard de marcador existe apenas no harness AAA.
4. **`staging-smoke.mjs` e `otel-e2e-check.mjs` importam `.ts` e são executados com `node`** (Node 20 no workflow). Sem loader/tsx, os imports dinâmicos de `packages/.../*.ts` tendem a falhar; **não executado**, portanto tratado como risco, não como defeito comprovado.
5. **`staging-smoke.mjs`**: usa `DeleteObjectCommand` sem import; o check `minio.delete` termina em `|| true` (sempre verdadeiro).
6. **Dockerfiles**: instalação sem lockfile e typecheck neutralizado (`|| true`) — já apontado na auditoria; o inventário confirma o estado atual.
7. **Smoke E2E deixa fixtures** (telefone `+5511988880011`, conversa, sessão) sem cleanup observado; identidade fixa favorece colisão entre runs no mesmo banco.
8. **`capture-design.mjs`** não possui assert de exit; serve para captura, não como gate.
9. **Harness AAA**: usa run único default (`aaa-20260912`) e `reuseExistingServer`; suporte a workers existe (`AAA_WORKER_INDEX`) mas não foi exercitado. Redis do harness já em 56680 (fora do staging) — ajuste recente registrado no `runtime/state.json`.
10. **Serviços de mídia/OTel** não estão provisionados neste host; a matriz indica onde são obrigatórios e onde podem ser mockados/skipados.

## 5. Recomendações priorizadas (propostas)

- **P0 — Isolamento de banco nos executores que mutam dados**: aplicar o guard de URL/marcador de `e2e/support/aaa/pg.ts` a `test:postgres-real`, `db:migrate`, `query-performance.mjs` e allowlist `*_dr_*` no DR; transformar fallback 5432/6379 em erro quando `CI=true`.
- **P0 — Coexistência de runs**: proibir `fuser -k`/`down -v` cego durante trabalho multiagente; teardown por data dir/pidfile; reservar faixas de porta por run (harness 56xxx já fora do staging).
- **P1 — Corrigir/validar scripts de staging**: executar via `tsx`/loader (ou compilar) e consertar o import faltante + assert tautológico; adicionar um caso negativo que falhe quando MinIO/ClamAV/Collector estiverem ausentes.
- **P1 — Fechar pendências documentais de AAA-00**: congelar perfil de benchmark e dataset (o gerador existe no harness), registrar serviços provisionados vs bloqueados por gate e documentar invocação explícita de `playwright.config.ts` (smoke) × `playwright.aaa.config.ts` (AAA).
- **P1 — Fixtures e limpeza**: namespace por run para telefones/e-mails/eventIds; cleanup por prefixo no smoke E2E; serializar suítes que apagam linhas no mesmo banco.
- **P2 — Verificações reais por pacote**: tornar `lint`/`typecheck` reais nos pacotes relevantes (A12) e remover placeholders; manter o inventário atualizado por hash a cada marco.

## 6. Itens de AAA-00 que este pacote ajuda a atender

| Critério de AAA-00 | Cobertura deste pacote |
|---|---|
| "Produzir fixtures sintéticas, portas exclusivas por worker, comando de teardown restrito e inventário de checks existentes" | **Inventário de checks**: coberto por `INVENTARIO_CHECKS.md`. Portas/teardown/fixtures: apenas documentados (já existem no harness); não implementados aqui. |
| "Inventariar serviços exigidos em cada gate e provisionar MinIO/ClamAV/OTel isolados antes dos cartões que exigem sua prova" | **Inventário de serviços**: coberto por `MATRIZ_SERVICOS.md`. **Provisionamento**: não executado; matriz indica onde é obrigatório e o fallback atual. |
| C00 (revisão/hash, ambiente marcado, namespace/portas, teardown restrito, logs sanitizados) | Evidência documental de fronteiras, portas e guardas; hash das fontes fixado em duas pontas. |
| Critérios de benchmark e falha deliberada do harness | **Não cobertos aqui** (o benchmark e o controle negativo pertencem ao run do coordenador). |
| `playwright.aaa.config.ts` para `e2e/aaa` | Documentado no inventário; arquivo existente no worktree, não avaliado por execução. |

## 7. Declaração de entrega

**DELIVERED** — pacote documental composto por `INVENTARIO_CHECKS.md`, `MATRIZ_SERVICOS.md` e este `RETORNO.md`, com snapshots de hash (início/fim) e zero divergência nas 46 fontes determinantes. Sem execução de suítes, sem provisionamento, sem alteração de produto, runtime, contratos, catálogo ou ambientes, sem subagentes. O coordenador deve revisar e incorporar ao estado canônico; **AAA-00 permanece aberta**.
