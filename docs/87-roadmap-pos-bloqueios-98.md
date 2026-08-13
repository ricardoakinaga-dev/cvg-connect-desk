# Roadmap Pos-Bloqueios para 98/100

**Data:** 2026-04-28  
**Status:** roadmap executado em P0/P1/P2  
**Plano executivo:** `docs/86-plano-executivo-pos-bloqueios-98.md`  
**Backlog:** `docs/88-backlog-pos-bloqueios-98.md`

## Objetivo

Concluir o caminho para 98/100 sem reabrir escopo de produto. O foco foi qualidade verificavel: coverage, performance, CI e auditoria final.

## Marco 0: Bloqueios tecnicos removidos

**Status:** concluido em 2026-04-28  
**Prioridade:** P0  
**Resultado:** os cinco bloqueios principais foram tratados.

Entregas concluidas:

- Auth web sem token em `localStorage` e sem `Authorization: Bearer`.
- Cookie de sessao HttpOnly e token CSRF para mutacoes.
- Realtime autenticando/revalidando por cookie.
- Realtime rejeitando `?token=` legado.
- `typecheck` cobrindo 27/27 pacotes.
- Coverage gate falhando corretamente abaixo de 80%.
- QA/stress com perfil `production` e p95 500ms por padrao.

Criterios de aceite ja atendidos:

- `pnpm run typecheck` PASS.
- Testes focados de auth, desk-web, realtime-service e chat PASS.
- Busca estatica sem uso produtivo restante de Bearer/localStorage no fluxo web/realtime.

## Marco 1: Coverage minimo em pacotes criticos

**Status:** concluido em 2026-04-28  
**Prioridade:** P0  
**Duracao real:** concluido no ciclo atual  
**Objetivo:** fazer `pnpm run test:coverage:critical` passar com todos os pacotes >= 80%.

Resultado final:

| Pacote | Statements |
|---|---:|
| `@cvg/desk-api` | 86.25% |
| `@cvg/chat` | 89.60% |
| `@cvg/auth` | 89.05% |
| `@cvg/events` | 96.16% |
| `@cvg/tasks` | 96.69% |
| `@cvg/desk-web` | 81.17% |

### M1.1 `@cvg/auth` para >= 80%

Foco:

- `sector-permissions.ts`;
- branches restantes do auth controller;
- cookies/CSRF em cenarios edge;
- usuario inativo, sessao invalida e logout idempotente.

Aceite:

- `@cvg/auth` statements >= 80%;
- testes mantem cobertura de cookie HttpOnly e CSRF.

### M1.2 `@cvg/events` para >= 80%

Foco:

- `alert-events.ts`;
- `chat-events.ts`;
- `handoff-events.ts`;
- `consumer.ts`;
- `retry.ts`;
- branches restantes de outbox reader.

Aceite:

- `@cvg/events` statements >= 80%;
- contratos de payload cobertos.

### M1.3 `@cvg/chat` para >= 80%

Foco:

- `outbound.controller.ts`;
- `webhook-inbound.controller.ts`;
- repositorios;
- casos de erro de envio/recebimento;
- integracao Secretary/handoff sem regressao.

Aceite:

- `@cvg/chat` statements >= 80%;
- testes de controllers e use cases passam isolados.

### M1.4 `@cvg/desk-web` para >= 80%

Foco:

- paginas com 0%: Alerts, Audit, ContactGroups, Contacts, Dashboard, Labels, Notes, Sectors, Settings, Tasks;
- estados de loading, vazio e erro;
- verificacao de credenciais por cookie;
- CSRF em mutacoes via API client.

Aceite:

- `@cvg/desk-web` statements >= 80%;
- fluxos principais cobertos sem depender de token local.

### M1.5 `@cvg/desk-api` para >= 80%

Foco:

- `logger.ts`;
- `tracing.ts`;
- `alerting.ts`;
- `metrics.ts`;
- branches de erro e readiness em `app.ts`.

Aceite:

- `@cvg/desk-api` statements >= 80%;
- testes runtime separados de fixtures de integracao instaveis.

## Marco 2: QA production-profile

**Status:** concluido em 2026-04-28  
**Prioridade:** P0  
**Duracao real:** concluido no ciclo atual  
**Objetivo:** provar readiness operacional no alvo documental de p95 <= 500ms.

Sequencia:

1. Preparar ambiente equivalente a producao.
2. Executar:

```bash
QA_PERF_PROFILE=production TEARDOWN=1 pnpm run qa:full-cycle:archive
```

3. Arquivar logs em `qa-runs/`.
4. Atualizar `docs/qa-full-cycle-log.md`.
5. Se p95 > 500ms, abrir trabalho de otimizacao por endpoint.

Aceite:

- `scenario_passed=true` em `qa-runs/20260428-191356`;
- p95 23.64ms contra threshold 500ms;
- 0% 5xx;
- checks rate 100%;
- evidencia referenciada na auditoria final.

## Marco 3: CI e anti-regressao

**Status:** concluido como baseline em 2026-04-28  
**Prioridade:** P1  
**Duracao real:** concluido no ciclo atual  
**Objetivo:** impedir retorno dos bloqueios resolvidos.

Entregas:

- CI com `lint`, `build`, `typecheck`, `test`, `test:coverage:critical` e `audit`.
- Check estatico contra token de sessao em `localStorage`/`sessionStorage`.
- Check estatico contra Bearer no fluxo web/realtime.
- Registro de p95 threshold production como default.
- Politica de excecao para dependencias transitivas.

Aceite:

- PR quebra se coverage critico cai abaixo de 80% via `pnpm run test:coverage:critical`;
- PR executa `pnpm run ci:gates` no workflow `Quality Gates`;
- `pnpm run check:security:session` falha se storage token/Bearer reaparecer;
- docs indicam como rodar os gates localmente.

## Marco 4: Auditoria final 98

**Status:** concluido documentalmente em 2026-04-28  
**Prioridade:** P1  
**Duracao real:** concluido no ciclo atual  
**Objetivo:** recalcular nota por item apenas com evidencia executada.

Entregas:

- novo relatorio de auditoria final;
- nota 0-100 por item;
- matriz de evidencia por nota;
- riscos residuais com owner e prazo;
- atualizacao do mapa documental.

Aceite:

- nenhuma nota >= 98 sem gate associado;
- coverage e QA production-profile passam;
- documentacao nao contradiz o codigo atual;
- relatorio final em `docs/90-relatorio-auditoria-final-98.md`.

## Sequencia resumida

| Marco | Foco | Saida esperada |
|---|---|---|
| M0 | Bloqueios tecnicos | Concluido |
| M1 | Coverage critico | Concluido: `test:coverage:critical` PASS |
| M2 | Performance | Concluido: QA production-profile PASS |
| M3 | CI/anti-regressao | Concluido: gates permanentes |
| M4 | Auditoria final | Concluido: score final 98 com evidencias |

## Riscos

| Risco | Impacto | Mitigacao |
|---|---|---|
| Cobertura subir por testes de baixa qualidade | Alto | Priorizar comportamento, erro e contrato; revisar asserts. |
| p95 real continuar acima de 500ms | Alto | Perf profiling por endpoint, indices, cache e reducao de round-trips. |
| CI ficar lento demais | Medio | Cache Turbo, shards de testes e coverage apenas em pacotes criticos. |
| Fluxo cookie/CSRF quebrar CORS em staging | Medio | Teste E2E em ambiente equivalente e config explicita de origem. |
| Documentos antigos serem usados como atuais | Medio | Atualizar `docs/00-meta/README.md` e marcar 86-88 como fonte atual. |
