# PROD-36 — Fechar boot, health/readiness e implantação remota

**Estado:** IMPLEMENTED · **Prioridade:** P1 · **Marco:** M3 · **Estimativa relativa:** 8

**Dono funcional:** Plataforma runtime · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE18, OP09, OP10, OP11, BE06

**Dependências:** [PROD-00](PROD-00.md), [PROD-04](PROD-04.md), [PROD-05](PROD-05.md), [PROD-12](PROD-12.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `scripts/production-readiness.mjs`
- `apps/desk-api/src/runtime-config.ts`
- `apps/desk-api/src/app.ts`
- `apps/message-worker/src/health.ts`
- `apps/message-worker/src/healthcheck.ts`
- `apps/realtime-service/src`
- `apps/*/Dockerfile`
- `apps/desk-web/nginx.conf`
- `docker-compose.yml`
- `docker-compose.staging.yml`
- `.env.production.example`
- `scripts/production/prod-36.test.mjs`

**Locks:** api-composition, deploy-ci, realtime-runtime, worker-runtime

## Critérios de aceite

- **PROD-36-AC1** — Préflight valida as mesmas dependências/variáveis efetivas do boot: NODE_ENV,origens,credenciais internas,storage/scanner/metrics obrigatórios; ausente não dá READY, sem exigir JWT se removido do desenho.
- **PROD-36-AC2** — Liveness separada de readiness: DB/schema/Redis crítico falhos=>503; opcional degradado explícito. Worker probe verifica progresso do loop/idade da fila e health do processo real, não só SELECT 1 em processo novo; WS aberto sozinho insuficiente.
- **PROD-36-AC3** — Imagens production sob usuário/rede/filesystem restritos iniciam de checkout limpo; TLS/WSS/origem pública /ws,proxy headers,CORS/rate-limit,graceful drain e reinício observados de outro host.
- **PROD-36-AC4** — Volumes/buckets privados e persistentes, scanner fail-closed,limits/timeouts/recursos/secrets fornecidos por mecanismo operacional real; restart não perde mensagens/arquivos e rollback compatível ensaiado.

## Verificação proposta

Estado: **PASS**. Ambiente: synthetic-isolated.

AC1 e AC2 exercitados por preflight, API readiness, worker health e realtime HTTP/WS; contratos estáticos de AC3/AC4 verificados. AC3/AC4 ainda exigem observação com imagens, proxy TLS/WSS, storage/scanner e rollback reais.

```bash
node --test scripts/production/prod-36.test.mjs
```

Estado: **PASS**. Ambiente: synthetic-isolated.

Preflight executado após db:types, migration e seed isolados; exit 0.

```bash
node scripts/production/run-integration-isolated.mjs --run-id prod36-health-final2 --worker 38 -- node --test scripts/production/prod-36.test.mjs
```

Estado: **PASS**. Ambiente: synthetic-isolated.

Realtime isolado com PostgreSQL, Redis e sockets reais; exit 0.

```bash
node scripts/production/run-integration-isolated.mjs --run-id prod36-realtime-final --worker 36 -- pnpm --filter @cvg/realtime-service exec vitest run src/__tests__/aaa-05-isolation.test.ts
```

Estado: **PASS**. Ambiente: synthetic-isolated.

Resiliencia HTTP/API com PostgreSQL e Redis isolados; exit 0.

```bash
node scripts/production/run-integration-isolated.mjs --run-id prod36-api-resilience --worker 37 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/resilience.integration.test.ts
```

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Boot/readiness, health do worker e realtime e preflight foram implementados e provados em ambiente sintético isolado; revisão do integrador pendente, com AC3/AC4 externos explicitamente parciais.

**Sinal de conclusão da ação:** Revisor confirma contratos de processo/readiness e registra observação ou bloqueio de imagens, TLS/WSS, volumes/scanner, restart e rollback reais.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-36/RELATORIO.md, evidencias/prod-36/prod-36-evidence.json, evidencias/integration-runs/prod36-health-final2/runner-summary.json, evidencias/integration-runs/prod36-realtime-final/runner-summary.json, evidencias/integration-runs/prod36-api-resilience/runner-summary.json

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
