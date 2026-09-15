# PROD-36 — Fechar boot, health/readiness e implantação remota

**Observação da auditoria:** 5/5 preflight e config Compose2/2 passam; AAA05 classe14/14. Entry point nativo falha R3-RT01; Docker/TLS/WSS/readiness/rollback reais não exercitados.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** OPS07, R3-RT01

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-36 / estado recebido PLANNED

**Estado:** PLANNED · **Prioridade:** P0 · **Marco:** M3 · **Estimativa relativa:** 5

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
- **PROD-36-R3-AC1** — Construir e iniciar imagem realtime pelo entrypoint declarado com os demais serviços próprios; observar readiness e /metrics503/401/200. Registrar digest da imagem executada para a verificação posterior de supply chain PROD35; não exigir conclusão de PROD35 para fechar PROD36.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: Ambiente sintético próprio; URL/identidade antes de imports. Testes reais usam runner validado e artifacts fora do histórico..

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
node --test scripts/production/prod-36.test.mjs
```

Estado: **NOT_RUN**. Ambiente: Ambiente sintético próprio; URL/identidade antes de imports. Testes reais usam runner validado e artifacts fora do histórico..

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
node scripts/production/run-integration-isolated.mjs --run-id prod36-health-final2 --worker 38 -- node --test scripts/production/prod-36.test.mjs
```

Estado: **NOT_RUN**. Ambiente: Ambiente sintético próprio; URL/identidade antes de imports. Testes reais usam runner validado e artifacts fora do histórico..

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
node scripts/production/run-integration-isolated.mjs --run-id prod36-realtime-final --worker 36 -- pnpm --filter @cvg/realtime-service exec vitest run src/__tests__/aaa-05-isolation.test.ts
```

Estado: **NOT_RUN**. Ambiente: Ambiente sintético próprio; URL/identidade antes de imports. Testes reais usam runner validado e artifacts fora do histórico..

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
node scripts/production/run-integration-isolated.mjs --run-id prod36-api-resilience --worker 37 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/resilience.integration.test.ts
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

5/5 preflight e config Compose2/2 passam; AAA05 classe14/14. Entry point nativo falha R3-RT01; Docker/TLS/WSS/readiness/rollback reais não exercitados. Registrar subtarefas de correção e prova conforme aceites, preservando o comportamento já correto.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
