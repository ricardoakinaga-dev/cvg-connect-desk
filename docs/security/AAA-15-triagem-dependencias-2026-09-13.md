# AAA-15 — Triagem de dependências e cadeia de fornecimento

- Tarefa: AAA-15 ("Atualizar dependências e triar alertas"), fase 1, R2, 5 pts.
- Achado de origem: A13 (`docs/auditorias/2026-09-12/RELATORIO.md`), área 16 (QA16).
- Contratos aplicáveis: C08 (runtime/package manager fixados, lock congelado, contrato de build) e C00 (ambiente isolado marcado por run).
- Revisão base desta triagem: `754f9badac46278e77d21de91c58eedb15e80581` (mesma de `runtime/ownership.json`), working tree compartilhada.
- Data: 2026-09-13. Runtime observado: Node `v24.20.0`, pnpm `10.33.0`.
- Escopo de escrita exercido: manifests (`package.json`) e `pnpm-lock.yaml`. Nenhum arquivo de fonte de domínio foi alterado.
- Evidência bruta: `/tmp/cvg-aaa-returns/aaa-15/` (logs, JSON de audit, OSV, SBOM, hashes).

## 1. Resultado

| Recorte | Antes | Depois | Meta |
|---|---|---|---|
| `pnpm audit` — Critical | 0 | 0 | 0 |
| `pnpm audit` — High | 27 | 0 | 0 |
| `pnpm audit --prod` — Critical | 0 | 0 | 0 |
| `pnpm audit --prod` — High | 8 | 0 | 0 |
| OSV-Scanner (High) | 27 ocorrências / 10 pacotes | 0 | 0 |
| OSV-Scanner (moderate) | 22 ocorrências | 4 | triar |
| `pnpm audit` — low | 3 | 0 | — |

O objetivo "zero High/Critical nas dependências implantadas" foi atingido no recorte de produção (`pnpm audit --prod`: 1 moderate residual, `@opentelemetry/core`, exceção EXC-AAA15-01). Nenhum scanner foi suprimido: não há `ignore`/`allowlist` adicionado; as mudanças são upgrades reais de versão.

## 2. Método

1. Inventário reproduzível antes/depois com `pnpm audit --json`, `pnpm audit --prod --json` e OSV-Scanner 2.5.1 (`--lockfile pnpm-lock.yaml`, banco OSV oficial; binário verificado por SHA-256 do release oficial `f9f25499…`).
2. Correção por grupos compatíveis via `pnpm.overrides` no manifest raiz e bump de ranges diretos; lockfile regenerado com `pnpm install` e revalidado com `pnpm install --frozen-lockfile` (exit 0).
3. Verificação comportamental dos contratos afetados: suítes por pacote antes/depois e macro-suites `build`/`typecheck`/`test` após as trocas.
4. Exceções registradas com dono, prazo, alcance e caminho de correção; nenhuma exceção autoriza vulnerabilidade comprovada de acesso ou dados.

## 3. Inventário antes → depois (foco)

### 3.1 Corrigidos — runtime/produção

| Pacote | Antes | Depois | Avisos | Caminho atingido | Ação |
|---|---|---|---|---|---|
| `fast-uri` | 3.1.0 | 3.1.7 | GHSA-v2hh-gcrm-f6hx, GHSA-7p8r-x3mc-p8w7, GHSA-q3j6-qgpj-74h6, GHSA-v39h-62p7-jpjc, GHSA-f65p-4m7j-42xc, GHSA-jqff-g426-hqxp, GHSA-4c8g-83qw-93j6 (high) | `@fastify/swagger → json-schema-resolver → fast-uri` (API) | override `<3.1.6 → 3.1.7`; range do consumidor `^3.0.5` respeitado |
| `@opentelemetry/propagator-jaeger` | 1.30.1 | 2.11.0 | GHSA-45rx-2jwx-cxfr (high) | `packages/tracing → sdk-trace-node → propagator-jaeger` | override `<2.9.0 → 2.11.0`; smoke real `sdk-trace-node@1.30.1 + propagator@2.11.0` com headers malformados, `register()` OK |
| `form-data` | 4.0.5 | 4.0.6 | GHSA-hmw2-7cc7-3qxx (high) | `axios` do `@cvg/gateway-adapter` (runtime) e `jsdom` (dev) | override `<4.0.6 → 4.0.6` |
| `uuid` | 9.0.1 e 11.1.0 | 11.1.1 | GHSA-w5hq-g745-h8pq (moderate) | `modules/auth`, `packages/auth` (v4) | dependência `uuid` não usada removida do `@cvg/gateway-adapter`; ranges de auth para `^11.1.1` |
| `react-router-dom` / `react-router` | 6.30.3 / 6.30.3 (+`@remix-run/router` 1.23.2) | 7.18.3 / 7.18.3 | GHSA-jjmj-jmhj-qwj2, GHSA-2j2x-hqr9-3h42, GHSA-337j-9hxr-rhxg, GHSA-wrjc-x8rr-h8h6 (moderate) | `apps/desk-web` | bump `^6.22.0 → ^7.18.3`; build+113 testes do front passam com a API v7 |

### 3.2 Corrigidos — dev/toolchain

| Pacote | Antes | Depois | Avisos | Caminho | Ação |
|---|---|---|---|---|---|
| `vite` | 5.4.21 | 7.3.6 | GHSA-fx2h-pf6j-xcff (high), GHSA-4w7w-66w2-5vf9, GHSA-v6wh-96g9-6wx3 (moderate) | `@cvg/desk-web` (dev) | bump `^5.1.4 → ^7.3.6`; deduplica com o vite já usado pelo vitest; `vite build` OK |
| `postcss` | 8.5.8 | 8.5.28 | GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849 (high), GHSA-fxqj-rqcc-2cmp, GHSA-qx2v-qp2m-jg93 (moderate) | `vite` (dev) | override `<8.5.23 → 8.5.28` |
| `nanoid` | 3.3.11 | 3.3.19 | GHSA-28wg-ghj8-5hjv, GHSA-2v37-7h3g-55p8, GHSA-xwg4-73v4-xw9w (high) | `postcss` (dev) | override `<3.3.18 → 3.3.19` |
| `ws` | 8.20.0 | 8.21.3 | GHSA-96hv-2xvq-fx4p (high), GHSA-58qx-3vcg-4xpx (moderate) | `jsdom` (dev); o serviço realtime já usava `^8.21.3` | override `<8.21.0 → 8.21.3` (dedupe) |
| `js-yaml` | 4.1.1 | 4.3.2 | GHSA-52cp-r559-cp3m, GHSA-5p4m-2wfm-xmqj, GHSA-2883-xcg3-v3hh (high), GHSA-h67p-54hq-rp68 (moderate) | `eslint → @eslint/eslintrc` (dev) | override `<4.3.2 → 4.3.2` |
| `browserslist` | 4.28.1 | 4.28.9 | GHSA-73wf-gq98-2v4g, GHSA-c83g-rgw3-j3cx (high) | `@babel/core` do `@vitejs/plugin-react` (dev) | override `<4.28.7 → 4.28.9` |
| `baseline-browser-mapping` | 2.10.12 | 2.11.23 | GHSA-w5vr-8v7q-w6rv (moderate) | `browserslist` (dev) | override `<2.11.0 → 2.11.23` |
| `brace-expansion` | 1.1.13 / 5.0.5 | 1.1.18 / 5.0.9 | GHSA-3jxr-9vmj-r5cp, GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895 (high), GHSA-jxxr-4gwj-5jf2 (moderate) | `eslint`/`typescript-eslint → minimatch` (dev) | overrides `<2 → 1.1.18` e `>=3.0.0 → 5.0.9` (linha 2.1.4 não é afetada) |
| `esbuild` | 0.21.5 (vite 5) e 0.27.4 (tsx 4.21) | 0.28.2 (tsx/`vite` 7) | GHSA-g7r4-m6w7-qqqr (low) | `vite` 5 e `tsx` (dev/runtime de tooling) | vite 5 removido; `tsx` bump `4.21.0 → 4.23.13` (`esbuild ~0.28.0`) |
| `turbo` | 2.8.21 | 2.10.12 | GHSA-3qcw-2rhx-2726 (low), GHSA-hcf7-66rw-9f5r (moderate) | toolchain de build | bump exato `2.8.21 → 2.10.12`; `turbo run build/test` OK |
| `@babel/core` | 7.29.0 | 7.29.7 | GHSA-4x5r-pxfx-6jf8 (low) | `@vitejs/plugin-react` (dev) | override `<8 → 7.29.7` |
| `@humanfs/node` | 0.16.7 | 0.16.8 | GHSA-p498-v437-472g (moderate) | `eslint` (dev) | override `<0.16.8 → 0.16.8` |

### 3.3 Exceções registradas (dono, alcance, expiração)

Nenhuma exceção cobre vulnerabilidade de acesso/dados comprovada.

| ID | Pacote / aviso | Sev. | Superfície | Alcance atual | Correção viável | Dono | Expira |
|---|---|---|---|---|---|---|---|
| EXC-AAA15-01 | `@opentelemetry/core@1.30.1` GHSA-8988-4f7v-96qf | moderate | Runtime (tracing) | `initTracing()` só ativa com `OTEL_ENABLED=true`; nenhum ambiente implantado declara baggage; Node limita headers a ~16 KB por padrão | exige OTel 2.x; `packages/tracing` usa a classe `Resource` removida em 2.x → adaptação de fonte fora do ownership desta tarefa; redistribuir ao lead | plataforma supply chain | 2026-12-31 |
| EXC-AAA15-02 | `vitest@3.2.7` + `@vitest/mocker@3.2.7` GHSA-82fw-gwwq-j7x9 | moderate | Dev/teste | O aviso só é **não autenticado** pelo caminho dos exports públicos `mockerPlugin`/`interceptorPlugin`, que registram handler no HMR WebSocket público do Vite em dev servers de terceiros; no Vitest CLI a própria browser mode usa RPC com token. Evidência deste repo (`raw/after/exc-aaa15-02-reachability.log`): 0 referências a `mockerPlugin`/`interceptorPlugin`, configs `vitest run` com environment `node`/`jsdom`, sem `browser`/`api`/`ui`/`server.host`; nenhum dev server é artefato implantado e o CI usa runner efêmero, logo o socket HMR não é exposto à rede (impacto do aviso é disclosure, sem integridade/availability) | vitest `>=4.1.11` é major e cruza 30+ workspaces; agendar upgrade controlado | plataforma build | 2026-12-31 |
| EXC-AAA15-03 | `esbuild@0.18.20` GHSA-67mh-4wv8-2f99 | moderate | Dev/CLI de migração | `drizzle-kit@0.31.10 → @esbuild-kit/esm-loader → core-utils`; o recurso vulnerável é o *dev server* do esbuild, não o bundling usado pelo drizzle-kit | `@esbuild-kit` fixa `~0.18.20`; override para `>=0.25` quebraria o contrato do consumidor. Aguardar drizzle-kit remover `@esbuild-kit` (sem release upstream até a data) | plataforma build/dados | 2026-12-31 |

## 4. Changelog de dependências (AAA-15)

- **Grupo 1 — HTTP/API runtime:** `fast-uri` 3.1.7 (override); `@opentelemetry/propagator-jaeger` 2.11.0 (override, substitui o código vulnerável mantendo `sdk-trace-node@1.30.1`); `form-data` 4.0.6 (override, cobre axios runtime e jsdom dev); `uuid` 11.1.1 (ranges de auth) e remoção de `uuid` não utilizado no gateway-adapter.
- **Grupo 2 — Frontend runtime:** `react-router-dom`/`react-router` 7.18.3.
- **Grupo 3 — Bundler/test dev:** `vite` 7.3.6; `postcss` 8.5.28; `nanoid` 3.3.19; `ws` 8.21.3.
- **Grupo 4 — Lint/type/build dev:** `eslint` permanece 9.39.4; transitivos `js-yaml` 4.3.2, `brace-expansion` 1.1.18/5.0.9, `browserslist` 4.28.9, `baseline-browser-mapping` 2.11.23, `@babel/core` 7.29.7, `@humanfs/node` 0.16.8.
- **Grupo 5 — Toolchain:** `turbo` 2.10.12, `tsx` 4.23.13 (raiz e apps/pacotes que declaram `tsx`); `esbuild` resultante 0.28.2.

Sem mudança de código de domínio; sem `ignore` de scanner. O lockfile foi regenerado uma única vez (`pnpm install`), mantendo `pnpm install --frozen-lockfile` verde.

## 5. Runtime e package manager (C08/D04)

- `packageManager`: `pnpm@10.33.0` (inalterado; `engines.pnpm` agora `>=10.33.0 <11.0.0`).
- `engines.node` agora `>=24.0.0 <25.0.0` — runtime único suportado pela evidência atual (local `v24.20.0`; Node 20 está EOL desde 2026-04). Mismatch com Node 20 apenas emite `WARN Unsupported engine` no pnpm, sem quebrar o install (verificado com Node 22).
- **Residual fora do ownership desta tarefa:** Dockerfiles (`apps/*/Dockerfile`, `services/db-init/Dockerfile`) e `.github/workflows/*.yml` ainda usam `node:20`. Redistribuir ao **AAA-14** ("Tornar builds e gates reproduzíveis", dono de `.github/workflows/ci.yml`, `services/db-init/Dockerfile`, turbo/tsconfig) o alinhamento de CI/imagens ao pin de Node 24; **AAA-23** fica apenas com o concern de runtime E2E/serviços reais. Não editar aqui para não invadir paths de outro cartão.

## 6. Ferramentas de segurança (estado e lacunas)

- Já existentes e não alterados (fora de `write_paths`): `.github/workflows/security.yml` com CodeQL, Gitleaks, Trivy (imagem, `exit-code: 1` em HIGH/CRITICAL), `actions/dependency-review-action` (`fail-on-severity: high`), `pnpm audit --audit-level=critical` e SBOM CycloneDX (anchore). Com o recorte agora zerado em High, recomenda-se ao **AAA-26** (e à auditoria final **AAA-28**) endurecer o gate de `critical` para `high`, e ao **AAA-14** alinhar Node 20 → 24 em CI/imagens (únicos donos desses paths).
- Adicionado no raiz (in-scope, `package.json`): scripts `security:audit` (`pnpm audit --audit-level=high`, exit 0) e `security:audit:prod` (`pnpm audit --prod --audit-level=high`, exit 0), codificando a barra de triagem.
- Disponibilidade local: OSV-Scanner usado (release oficial, SHA-256 verificado); `gitleaks`/`trivy` sem binário local; daemon Docker indisponível → nenhum scan de imagem local (controle compensatório: job Trivy do CI).
- SBOM local gerado em CycloneDX 1.6 via OSV-Scanner (`--all-packages`, 694 componentes) em `/tmp/cvg-aaa-returns/aaa-15/artifacts/sbom.cyclonedx.json`; o CI mantém o SBOM oficial via anchore.

## 7. Verificação e regressão

- Contrato declarado `pnpm --filter @cvg/desk-web test`: 113/113 antes e depois.
- Fronteiras trocadas: `@cvg/tracing` 7/7, `@cvg/gateway-adapter` 20/20, `@cvg/auth` 22/22, `@cvg/auth-module` 9/9.
- Macro `pnpm build`: 33/33 tasks (inclui `vite v7.3.6` no desk-web). `pnpm typecheck`: 6/6.
- Macro `turbo run test --continue` com PostgreSQL 16 e Redis isolados do run (C00, portas 56462/56472, banco `connect_desk_db`): 29/33 tasks verdes. No run paralelo o task `@cvg/desk-api` teve 9 arquivos falhos, de duas causas distintas: (a) 7 guardas de isolamento de run de predecessor (aaa-04/05/09/10/11/12/19 exigem `DATABASE_URL` próprio em `127.0.0.1:56432`); (b) 2 falhas de contenção de banco compartilhado entre suítes concorrentes — `privacy-dsar` com `23505` em `roles_name_unique` e `transfers-routes` com `23503` de FK em `user_roles`. O reprocessamento sequencial do `@cvg/desk-api` num banco recém-migrado (`raw/after/test-desk-api-sequential.log`; extração reproduzível em `raw/after/desk-api-contention-summary.log`) mostra `privacy-dsar` ✓ (3 testes) e `transfers-routes` ✓ (10 testes), com 158 passed / 121 skipped e 7 arquivos falhos — todos guardas (a). `chat` 34 passed, `events` 156 passed, `realtime-service` 81 passed; falhas restantes apenas aaa-08/aaa-07/aaa-05 por guarda. Sem DB o resultado é 26/33, com as mesmas causas ambientais.
- Migrações e schema: `db:migrate` exit 0; `db:check` exit 0 (38 tabelas).
- Reprovação negativa das versões vulneráveis: scanners apontavam 27 High (full) / 8 High (prod) antes; zero depois. Smoke do propagador Jaeger com 4 headers malformados não lança exceção.

## 8. Limitações e riscos residuais

1. Exceções EXC-AAA15-01/02/03 continuam abertas com dono e expiração em 2026-12-31; nenhuma é de acesso/dados.
2. Sem Docker: não houve scan da imagem efetivamente implantada nem validação `docker build`; a prova de runtime é local (Node 24.20.0) e o gate de imagem permanece no CI.
3. O pin de Node 24 ainda não se reflete em Dockerfiles/CI (fora do ownership); enquanto isso, builds de imagem continuam em Node 20 (EOL). Redistribuído ao AAA-14; AAA-23 cobre apenas E2E/runtime real.
4. `@eslint/js@10` com `eslint@9` já emitia aviso de peer antes desta tarefa; não foi alterado para não ampliar o lote.
5. As suítes de integração guardadas por run de predecessor não são executáveis sob o run AAA-15 por desenho do C00; a integração/reteste do lead deve reexecutá-las nos runs de origem ou promover a unificação de namespace.

## 9. Próxima ação

Integrar o candidato, reexecutar `pnpm install --frozen-lockfile`, `pnpm audit --prod` e as suítes guardadas no run de origem; redistribuir ao lead a adaptação OTel 2.x (EXC-AAA15-01) e o upgrade major de vitest (EXC-AAA15-02) em cartões próprios; alinhar Node 24 em CI/imagens no **AAA-14**, endurecer o gate de audit para `high` no **AAA-26** (auditado pelo **AAA-28**) e tratar runtime E2E no **AAA-23**.
