# PROD-05 — Relatório de execução (sessão, rotação e revalidação HTTP/WS)

**Data:** 2026-09-13 · **Candidato:** `754f9badac46278e77d21de91c58eedb15e80581` + worktree (não commitado)
**Runs isolados:** `prod05` (worker 15, `cvg_aaa_prod05_w15` em 127.0.0.1:57932 / Redis 127.0.0.1:56830),
`prod05-ws` (worker 16, `cvg_aaa_prod05_ws_w16` em 127.0.0.1:58032 / Redis 127.0.0.1:56840) e a
revalidação `prod05-r2b` (worker 15, `cvg_aaa_prod05_r2b_w15` em 127.0.0.1:57932 / Redis 127.0.0.1:56830)
— nunca o banco do host.
Teardown `{ stopServices: true, dropDatabase: true }` em ambos.

Estado do cartão: **IMPLEMENTED / aguardando revisão do integrador — não declarado DONE**.
O delta inclui a remoção da validação legada de `JWT_SECRET` em
`apps/desk-api/src/runtime-config.ts`; o restante é prova (testes) + documentação.
Estado de partida: C01 constava `NOT_RUN no worktree` em `CONTRATOS.md`/AAA-03; a suíte HTTP+PG foi reexecutada.

## 1. Reprodução e limite atual (antes do delta)

| Fonte | Limite antes | Ação |
|---|---|---|
| `packages/auth/src/__tests__/session-policy.test.ts` | 13 testes unitários, sem casos de ordem/limite combinados | reforçado para 18 |
| `apps/desk-api/src/__tests__/aaa-03.integration.test.ts` | HTTP+PG real existente, mas rotulado NOT_RUN no worktree | reexecutado em PROD-05 via nova suíte (mantido intacto) |
| `apps/realtime-service/src/__tests__/aaa-05-isolation.test.ts` | hardcoded em PG a5 `:56432`/Redis `:56684` com marcador fixo `aaa-20260912-a5` (não rodaria em run novo) | derivado do ambiente (run-context), mantendo marcador/isolamento estritos |
| Revalidação WS × política | prova comportamental só de 401→4002; 403 × indisponibilidade × rede não distinguidos | 3 testes novos em `realtime-auth-behavioral.test.ts` |
| Log/URL de token no HTTP | não havia varredura | varredura + achado do `req.url` (ver §5) |

Achado que motivou correção de harness (não de produção): o serviço realtime não
auto-inicia com `NODE_ENV=test` (`apps/realtime-service/src/index.ts:1302-1305`);
o child do teste sobe com `NODE_ENV=development`, como no prod-04.

## 2. Delta (arquivos e linhas no estado atual)

### Testes novos/alterados (escopo permitido)
- `apps/desk-api/src/__tests__/production/prod-05.test.ts` — **novo, 961 linhas**. Provisiona PG/Redis
  isolados, migra, sobe `buildDeskApiApp` com `loggerStream` cativo e o realtime-service real
  (`tsx src/index.ts`) para sockets reais. 17 testes (`:1-961`).
- `packages/auth/src/__tests__/session-policy.test.ts:107-151` — describe novo
  "limites exatos e rotação (reforço C01)": normal+absoluto no mesmo instante, `lastSeenAt` futuro
  não estende absoluto, idle exato, absoluto persistido preservado, normal derivado de `created_at`.
- `apps/realtime-service/src/__tests__/aaa-05-isolation.test.ts:29-57,393-421` — derivação do run:
  `DATABASE_URL`/`REDIS_URL` devem bater exatamente com `getRunContext()`; banco `cvg_aaa_*`;
  marcador `aaa_environment_marker` único e igual ao `runId`. Nenhum assert de isolamento/marcador
  foi afrouxado (14/14 mantidos).
- `apps/realtime-service/src/__tests__/realtime-auth-behavioral.test.ts:324-381` — 403 fecha 4002;
  503 não revoga e a conexão segue autenticada; falha de rede real (auth server fechado) não revoga;
  spy de `console` prova que o token legado de URL não é ecoado nem logado.

### Produção
- `apps/desk-api/src/runtime-config.ts` deixou de validar a configuração legada de `JWT_SECRET`;
  `packages/auth/src/session-policy.ts`,
  `auth.repository.ts` e `middleware.ts` foram inspecionados e permanecem íntegros ao C01
  (o delta do outro executor em `permission-service`/`middleware` foi preservado).

### Evidências
- `docs/producao-2026-09-13/evidencias/prod-05/` — `RELATORIO.md`, `prod-05-probes.json`,
  `ui01-static.json`, `ac4-config-audit.md`, `logs/` (db-migrate, desk-api, realtime-child,
  timezone, ws-idle-cut, query-token-log-residual, auth-tests, ui01-web-realtime, teardown).
- `docs/producao-2026-09-13/evidencias/integration-runs/prod05/` e `prod05-ws/` — `runner-summary.json`
  (exit 0) e `runner-output.log`.

## 3. Aceites

### AC1 — token opaco só hash; 7d/30d/24h; limite exato nega; rotação/legado (PROVADO)
- Unitários (`logs/auth-tests.log`, exit 0): defaults 7d/30d/24h; `>=` nega no limite exato de
  normal/absoluto/idle; `resolveSessionDeadlines` preserva o absoluto persistido e ancora o legado
  no `created_at`. 53 testes no pacote (`session-policy` 18).
- HTTP+PG real (`prod-05-probes.json`): login devolve `uuid.hex48` (não-JWT) e o banco só guarda
  SHA-256 (`token = tokenHash = sha256`); `created_at + 7d/30d` com tolerância 2s;
  `expires_at = now()` → 401 `Token expired`; `absolute_expires_at = now()` → 401 `Session expired`;
  `last_seen_at = now-24h` → 401 `Session idle timeout` (me e rotate).
- Legado: `created_at = now-29d` com `expires_at` válido e `absolute = null` → me 200 e rotação
  materializa absoluto = `created_at + 30d`; `created_at = now-31d` → 401 `Session expired` (me e rotate).
- Rotação: absoluto idêntico antes/depois (epoch ms exato) inclusive com absoluto a 1h do fim;
  sucessora com `expires_at <= absoluto`.

### AC2 — HTTP+PG reais: ciclo, desativado, concorrência, fuso (PROVADO)
- login → me 200 → rotate 200 → token antigo 401 → sucessor 200 → logout idempotente →
  logout-all 200 zera as sessões; logout-all com token expirado → 401 sem derrubar sessão ativa.
- `isActive=false` → me/rotate 401 `User not found or inactive` sem apagar a sessão (reativado volta a 200);
  logout com usuário inativo ainda 200.
- Duas rotações concorrentes: statuses `[200, 401]`, 2 linhas, 1 ativa, 1 `revoked_reason=rotation`;
  vencedora acessa, token original 401.
- TZ `America/Sao_Paulo` (processo e offset -180; `timezone.json`): `created_at+7d/30d` exatos em epoch,
  rotação preserva o absoluto e não estende `now+7d`; `logs/ws-idle-cut.json` mostra corte idle em 302ms.

### AC3 — revalidação WS e sucessor; 401/403 × rede; token fora de URL/log (PROVADO COM RESIDUAL)
- WS real (child do realtime) contra a app real: sucessor de rotação autentica (`auth.success`),
  token antigo recebe `auth.error` e fecha **4003**; sessão que vira idle (>24h) fecha **4002 em 302ms**
  com `auth.revalidate.error` e o HTTP na mesma sessão retorna 401 `Session idle timeout`
  (mesma `evaluateSession`); usuário desativado fecha 4002 ≤5s; revogação fecha 4002 ≤5s sem afetar
  outra sessão.
- 401/403 × rede (`realtime-auth-behavioral.test.ts`): 403 → 4002; 503 → conexão permanece e segue
  respondendo a ping; auth server fechado (fetch failed) → conexão permanece e não emite
  `auth.revalidate.error` (só a entrega falha fechado).
- aaa-05 adaptado rodou **14/14** em run isolado real (worker 16), cobrindo revogação de sessão em
  ≤5s e isolamento de canais com marcador derivado do run.
- Tokens em URL/log: cliente web conecta sem `token=` e autentica por mensagem
  (`apps/desk-web/src/__tests__/realtime.test.ts:83-95`, 21/21); WS legado com `?token=` não é
  ecoado nem logado (spy de console); HTTP só aceita `Authorization` (querystring → 401) e o log do
  desk-api não contém nenhum token/Bearer dos fluxos efetivos.
  **Residual demonstrado:** o logger de request registra `req.url` integral; em `?token=` (fora do
  contrato) o valor ecoa no log — `logs/query-token-log-residual.json` (`queryTokenEchoedInRequestLog: true`).

### AC4 — boot sem JWT; segredo interno efetivo (DOCUMENTADO + PROVADO)
- App real sobe com `JWT_SECRET` ausente; token continua opaco; varredura de
  `JWT_SECRET|jsonwebtoken|jwt.sign|jwt.verify` em `apps/desk-api/src` + `packages/auth/src`
  (sem `__tests__`) = 0 hits.
- Guarda interna efetiva por `INTERNAL_EVENTS_SECRET` (ordem documentada em `internal-auth.ts:11-15`):
  `/events` 401 sem chave, 401 com chave errada e/ou Bearer de usuário, 200 com a chave correta.
- O código de runtime do `desk-api` e `packages/auth` não contém consumidor JWT; a configuração de
  produção também não exige `JWT_SECRET`. `production-readiness.mjs` ainda reconhece o placeholder
  legado como defesa de compatibilidade do gate, mas isso não habilita nem usa autenticação JWT.

### UI01 — sessão da UI não depende de token exposto (ESTÁTICO)
- `apps/desk-web/src/lib/api.ts:85-96,123-136,173-182` — token do storage vai só em header
  `Authorization`; `realtime.ts:199-218,288` — URL sem token e auth por mensagem; nenhuma ocorrência
  de `token=` em `apps/desk-web/src` além da asserção negativa do teste. `ui01-static.json`.
  Limitação: sem browser real (estático + unit jsdom).

## 4. Comandos e resultado

| Comando | Resultado |
|---|---|
| `TZ=America/Sao_Paulo node scripts/production/run-integration-isolated.mjs --run-id prod05 --worker 15 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-05.test.ts` | **exit 0** — 17/17 (`integration-runs/prod05/runner-summary.json` exitCode 0) |
| `TZ=America/Sao_Paulo node scripts/production/run-integration-isolated.mjs --run-id prod05-r2b --worker 15 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-05.test.ts` | **exit 0** — 17/17 (`integration-runs/prod05-r2b/runner-summary.json` exitCode 0) |
| `TZ=America/Sao_Paulo node scripts/production/run-integration-isolated.mjs --run-id prod05-ws --worker 16 -- pnpm --filter @cvg/realtime-service exec vitest run src/__tests__/aaa-05-isolation.test.ts` | **exit 0** — 14/14 (`integration-runs/prod05-ws/runner-summary.json` exitCode 0) |
| `pnpm --filter @cvg/auth test` | **exit 0** — 6 arquivos / 53 testes |
| `pnpm --filter @cvg/realtime-service exec vitest run src/__tests__/realtime-auth-behavioral.test.ts` | **exit 0** — 8/8 |
| `pnpm --filter @cvg/desk-web exec vitest run src/__tests__/realtime.test.ts` | **exit 0** — 21/21 |
| `pnpm --filter @cvg/desk-api exec tsc --noEmit` · `pnpm --filter @cvg/realtime-service exec tsc --noEmit` · `pnpm --filter @cvg/auth exec tsc --noEmit` | exit 0 |

**Hashtags de fonte (sha256):** `session-policy.ts` `ee5aa148…`; `auth.repository.ts` `9f378a0c…`;
`middleware.ts` `bfdb4d9e…`; `prod-05.test.ts` `588a53cf…`; `aaa-05-isolation.test.ts` `d7d5ac6b…`;
`realtime-auth-behavioral.test.ts` `8c88504b…`; `session-policy.test.ts` `ba79ffe5…`.

## 5. Riscos e limitações (honestos)

1. **`req.url` no log (MÉDIO):** token em querystring, se enviado por cliente fora do contrato,
   aparece no log de request do Fastify (`PINO_REDACT_PATHS` cobre headers/body, não URL). Não afeta
   cliente efetivo (web usa header/mensagem), mas é hardening recomendado: `serializers.req`/
   `disableRequestLogging` ou rejeitar `?token=`. Fora do escopo de escrita deste cartão — dono C09.
2. **Modo legado `?token=` do realtime (`extractTokenFromUrl`, `apps/realtime-service/src/index.ts:207-217`)
   permanece aceito por compatibilidade.** O servidor não o loga/ecoa (provado), mas o cliente legado
   expõe o token na URL; recomenda-se remover quando não houver consumidores. Dono C09/C02.
3. **Compatibilidade do readiness:** `production-readiness.mjs` ainda rejeita um placeholder
   `JWT_SECRET` legado, embora o runtime não o consuma; manter a checagem até o gate PROD-36 decidir
   sua remoção sem reabrir o contrato de sessão.
4. **Sem browser real** para UI01 e sem `playwright` nesta execução; prova é estática + jsdom.
5. **`aaa-05` testa 3-4 nós em processo, não cluster Docker**; fanout entre processos é PROD-12.
6. Teste `prod-05` reexecuta `db:migrate` além do runner (robustez standalone); nos dois runs o exit
   final foi 0 e o teardown derrubou PG/Redis do run (ver `teardown.json`; o `runner-summary` do
   runner mostra `stopped:false` apenas porque o teardown do teste já havia encerrado).

## 6. Rollback

- Reverter apenas: `apps/desk-api/src/__tests__/production/prod-05.test.ts` (novo),
  `packages/auth/src/__tests__/session-policy.test.ts` (bloco `:107-151`),
  `apps/realtime-service/src/__tests__/aaa-05-isolation.test.ts` (derivação do run),
  `apps/realtime-service/src/__tests__/realtime-auth-behavioral.test.ts` (3 testes + spy),
  e `docs/producao-2026-09-13/evidencias/prod-05/**`.
- A alteração de runtime é isolada à validação de configuração em
  `apps/desk-api/src/runtime-config.ts`; não houve alteração de migração/schema neste cartão.
- `aaa-05-isolation.test.ts` no estado antigo exigia PG a5 fixo; o rollback desse arquivo volta a
  restringir a suíte ao run histórico (não afeta o run prod05-ws já evidenciado).

## 7. Próxima ação

Integrador revalida os aceites no candidato e decide sobre os residuais 1–3 (hardening de log e
checagem legada do readiness) antes de qualquer DONE; D01/PROD-04 não é pré-requisito deste cartão,
mas a fonte efetiva de permissões foi preservada.
