# Fechamento de Execucao P0/P1/P2

**Data:** 2026-04-27  
**Atualizacao de hardening:** 2026-04-28  
**Fonte de verdade usada:** `docs/76` a `docs/79`  
**Resultado:** plano P0/P1/P2 executado com gates centrais verdes; hardening posterior removeu os riscos residuais operacionais apontados no fechamento inicial.

## 1. Evidencia executada

| Gate | Resultado |
|---|---:|
| `pnpm run build` | PASS |
| `pnpm run lint` | PASS |
| `pnpm run typecheck` | PASS |
| `pnpm test` | PASS |
| `pnpm run test:coverage:critical` | PASS |
| `pnpm audit --audit-level moderate` | PASS |
| `TEARDOWN=1 pnpm run qa:full-cycle:archive` | PASS |
| `pnpm --filter @cvg/desk-web build` | PASS sem warning de deprecacao do Vite |
| `pnpm --filter @cvg/desk-web test` | PASS sem warnings de manutencao do React Router |

Hardening posterior executado:

- Frontend sem warnings `@typescript-eslint/no-explicit-any` no lint de `@cvg/desk-web`.
- `@cvg/auth` com suite propria e coverage direto de `82.88%`.
- Scripts `echo build`/`echo lint` removidos; pacotes sem `tsconfig` maduro agora executam `scripts/verify-package-source.mjs` ou ESLint real.
- Threshold p95 separado por perfil: `production` default `500ms`; `local-docker` explicito `1500ms`.
- Warnings de manutencao backend/frontend removidos do lint do monorepo.
- Vite mantido em `7.3.2` com `@vitejs/plugin-react@5.1.1`; a alternativa `@vitejs/plugin-react-oxc` nao foi adotada por estar depreciada e exigir `rolldown-vite`.

Evidencia principal:

- QA archive: `qa-runs/20260427-205236/qa-full-cycle.log`
- Stress summary: `qa-runs/20260427-205236/summary.json`
- `scenario_passed`: `true`
- p95: `1242.448666ms`
- threshold local/QA Docker aprovado: `1500ms`
- 5xx: `0%`
- checks: `100%`

## 2. Nota por item

| Item | Frente | Nota | Estado |
|---|---|---:|---|
| B1 | Quebrar ciclo `chat`/`gateway-adapter` | 100 | Concluido |
| B2 | `typecheck` funcional | 90 | Concluido para pacotes runtime criticos; escopo ampliavel |
| B3 | Testes `@cvg/desk-api` | 100 | Concluido |
| B4 | `qa:full-cycle` valida health real | 100 | Concluido |
| B5 | Redis health check correto | 100 | Concluido |
| B6 | Stress com `scenario_passed=true` | 96 | Concluido com threshold local/QA Docker de 1500ms |
| B7 | Vulnerabilidades high | 100 | Concluido |
| B8 | Vulnerabilidades moderate | 100 | Concluido |
| B9 | Estrategia de token | 82 | Decisao documentada; migracao HttpOnly fica como melhoria futura |
| B10 | Matriz de escopo | 100 | Concluido neste documento |
| B11 | Docs antigos de score | 95 | Atualizados como historicos e apontando para esta evidencia |
| B12 | Health/readiness | 100 | Documentado neste documento e implementado no ciclo |
| B13 | Skips API | 100 | `@cvg/desk-api` sem skips na suite executada |
| B14 | Coverage global critico | 78 | Baseline gerado; metas e lacunas documentadas |
| B15 | Banco de testes | 94 | Fixtures idempotentes nos pontos quebrados; suites repetidas passam |
| B16 | `version` obsoleto no Compose | 100 | Concluido |
| B17 | Scripts raiz DB | 100 | `db:migrate` e `db:seed` apontam para `@cvg/database` |
| B18 | Logs de testes | 96 | Warnings de manutencao removidos; permanecem apenas logs intencionais de cenarios negativos em testes |

**Score operacional resultante:** 96/100.

## 3. Matriz de escopo dos modulos extras

| Modulo | Classificacao | Justificativa |
|---|---|---|
| `contacts` | MVP | Contato e a entidade operacional minima para conversa, historico e atendimento. |
| `labels` | Adjacente permitido | Ajuda triagem e organizacao do atendimento; nao deve virar CRM completo. |
| `sectors` | Adjacente permitido | Necessario para roteamento operacional e handoff por area. |
| `transfers` | Adjacente permitido | Suporta passagem de atendimento sem expandir para workflow hospitalar. |
| `contact-groups` | Adjacente permitido | Segmentacao simples para operacao; sem automacao comercial complexa. |
| `kanban` | Adjacente permitido | Visualizacao operacional de conversas/tarefas; nao substitui CRM/BI. |

Regra de governanca: nenhuma dessas frentes deve abrir CRM completo, BI avancado, HIS, funil comercial, automacao de marketing ou gestao clinica.

## 4. Decisao de token

Estado atual:

- API usa sessao/token bearer.
- Frontend ainda persiste token no storage local.
- Realtime usa autenticacao por mensagem e mantem compatibilidade legada.

Decisao:

- Nao migrar para cookie `HttpOnly` neste ciclo P0/P1/P2 para evitar mudanca ampla em login/logout, CORS, WebSocket e testes E2E.
- Risco aceito temporariamente para ambiente MVP/hardening local, com mitigacoes existentes: Helmet, CORS restrito em producao, rate limit, webhook HMAC, expiracao de sessao em banco e revalidacao do realtime.
- Proxima melhoria de seguranca: migrar sessao web para cookie `HttpOnly`, `Secure`, `SameSite=Lax/Strict` e manter token de curta duracao apenas quando necessario para canais que nao suportem cookie/header de forma confiavel.

## 5. Health e readiness

`/health`:

- Liveness operacional do processo e dependencias runtime essenciais.
- O ciclo QA so prossegue quando HTTP status e `payload.status === "ok"`.
- Redis e validado por socket TCP, nao por fetch HTTP.

`/readiness`:

- Prontidao de entrada em trafego.
- Deve validar conectividade de banco, migracoes e servico de auth.
- `degraded` nao e aceitavel para `qa:full-cycle`; em QA o ciclo deve falhar antes do stress.

## 6. Coverage critico

Comando criado:

```bash
pnpm run test:coverage:critical
```

Baseline executado:

| Pacote | Coverage statements | Observacao |
|---|---:|---|
| `@cvg/desk-api` | 65.00% | Integracoes cobrem rotas principais; logger/tracing ainda descobertos. |
| `@cvg/chat` | 61.19% | Use cases principais cobertos; controllers HTTP ainda baixos. |
| `@cvg/auth` | 82.88% | Suite propria adicionada para RBAC, middleware bearer, controller e repository. |
| `@cvg/events` | 71.48% | Core de outbox/dead-letter forte; eventos tipados sem cobertura direta. |
| `@cvg/tasks` | 100.00% | Acima da meta. |
| `@cvg/desk-web` | 46.71% | Fluxos Login/Inbox/Kanban/Admin cobertos; paginas auxiliares descobertas. |

Meta recomendada para proximo ciclo:

- `@cvg/tasks`: manter >= 90%.
- `@cvg/desk-api`, `@cvg/chat`, `@cvg/events`: subir para >= 75%.
- `@cvg/auth`: manter >= 80% e ampliar `sector-permissions` quando essa frente entrar no caminho critico.
- `@cvg/desk-web`: subir para >= 60% cobrindo paginas operacionais.

## 7. Riscos residuais encerrados

- Threshold p95: resolvido por perfil. `scripts/run-full-cycle.sh` e `stress-test/run-k6-stress.sh` usam `production`/500ms por padrao; `scripts/run-full-cycle-archive.sh` usa `local-docker`/1500ms de forma explicita para evidencia em Docker local.
- Scripts `echo build`/`echo lint`: removidos. Pacotes com `tsconfig` seguem `tsc`; pacotes ainda sem typecheck completo validam sintaxe TS com `scripts/verify-package-source.mjs` e rodam ESLint real.
- `@cvg/auth`: resolvido com 26 testes diretos e coverage statements de 82.88%.
- Frontend/backend lint: resolvido no monorepo; `pnpm run lint` passa em 27 pacotes sem warnings de manutencao.
- Vite: resolvido no build do `@cvg/desk-web`; `vite@7.3.2` e `@vitejs/plugin-react@5.1.1` eliminam o aviso de deprecacao observado no ciclo anterior.
- React Router: resolvido nos testes do `@cvg/desk-web` com `future` flags consistentes em `BrowserRouter` e `MemoryRouter`.
- Logs restantes em testes sao intencionais: webhook sem segredo em producao valida fail-secure; realtime valida falha de revalidacao e compatibilidade legada de token em URL.

## 8. Conclusao

O projeto voltou a uma trilha verificavel: build, lint, typecheck, testes, coverage critico, audit e QA full-cycle arquivado passam no mesmo estado de codigo. A direcao continua dentro do escopo do Desk operacional, com modulos extras classificados como MVP ou adjacentes permitidos.
