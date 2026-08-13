# Plano Executivo: Reconciliacao e Hardening para Retomar 96/100

**Data:** 2026-04-27  
**Base:** `docs/76-relatorio-auditoria-escopo-estado-atual.md`  
**Objetivo:** sair do estado auditado de **76/100** para um estado verificavel de **96/100**, sem expandir escopo de produto.

> Atualizacao de fechamento: o plano P0/P1/P2 foi executado em 2026-04-27. A evidencia consolidada esta em `docs/80-fechamento-execucao-p0-p1-p2.md` e o QA final PASS esta em `qa-runs/20260427-202434/summary.json`.

## 1. Decisao executiva

O projeto nao precisa de novas features neste momento. Precisa de uma fase controlada de reconciliacao tecnica, estabilizacao de testes, hardening de seguranca e ajuste da documentacao para refletir o estado real.

Diretriz:

- congelar expansao funcional;
- priorizar gates vermelhos;
- manter o Desk dentro do MVP operacional;
- transformar `build`, `lint`, `typecheck`, `test`, `audit` e `qa:full-cycle` em fontes confiaveis de verdade;
- reclassificar a nota apenas depois de evidencia executada.

## 2. Estado atual

| Frente | Estado | Nota atual |
|---|---|---:|
| Escopo de produto | Majoritariamente aderente | 84 |
| Arquitetura modular | Bloqueada por ciclo entre chat/gateway | 68 |
| Build/lint/typecheck | Gates quebrados | 43 |
| Testes | Muitas suites passam, API falha | 70 |
| Seguranca | Vulnerabilidades e token em localStorage | 62 |
| QA full-cycle | Falha em p95 e health permissivo | 55 |
| Documentacao | Rica, mas otimista | 78 |

## 3. Metas de saida

Para declarar 96/100 novamente, todos os criterios abaixo devem estar verdes:

- `pnpm run build` passa.
- `pnpm run lint` passa.
- `pnpm run typecheck` passa ou e substituido por gate equivalente documentado.
- `pnpm test` passa na raiz.
- `pnpm audit --audit-level moderate` nao retorna vulnerabilidade high e tem plano documentado para qualquer moderate residual.
- `TEARDOWN=1 pnpm run qa:full-cycle` passa com `scenario_thresholds.scenario_passed=true`.
- Health do ciclo valida payload `status === "ok"`, nao apenas HTTP 200.
- Documentos 72/73/75 sao atualizados com resultado real.
- Escopo dos modulos extras e classificado como `MVP`, `adjacente permitido` ou `futuro`.

## 4. Principios de execucao

1. **Sem feature nova ate gates verdes.**
2. **Corrigir a causa, nao relaxar teste.**
3. **Threshold so muda com decisao documentada.**
4. **Seguranca bloqueia producao.**
5. **Documentacao deve seguir evidencia, nao antecipar resultado.**

## 5. Frentes de trabalho

### Frente A: Arquitetura e build

Objetivo: quebrar a dependencia circular `@cvg/chat` <-> `@cvg/gateway-adapter` e recuperar build/lint.

Entregas:

- Separar contratos compartilhados em modulo neutro ou em `@cvg/shared`.
- Remover dependencia de `@cvg/gateway-adapter` dentro de `@cvg/chat`, ou inverter via interface injetada.
- Garantir que `turbo run build` e `turbo run lint` executem sem ciclo.

Nota alvo: 90+.

### Frente B: Typecheck real

Objetivo: tornar `pnpm run typecheck` confiavel.

Entregas:

- Adicionar script `typecheck` em todos os apps/packages/modules relevantes.
- Atualizar `turbo.json` com task `typecheck`.
- Remover scripts placeholder quando mascararem falta de validacao.

Nota alvo: 90+.

### Frente C: Testes e fixtures

Objetivo: estabilizar `pnpm test` e `@cvg/desk-api`.

Entregas:

- Corrigir fixtures de roles duplicadas.
- Corrigir testes de rate limit que falham no login.
- Corrigir teste de CORS vs webhook production missing secret.
- Corrigir teste de contacts com normalizacao de telefone.
- Remover skips injustificados ou documentar motivo e plano.

Nota alvo: 90+.

### Frente D: Seguranca e dependencias

Objetivo: reduzir risco de supply chain e sessao.

Entregas:

- Atualizar Fastify para versao corrigida.
- Atualizar Vite/esbuild/postcss conforme compativel.
- Atualizar axios/follow-redirects.
- Atualizar ou substituir uuid vulneravel.
- Decidir plano de token: migrar para cookie `HttpOnly` ou documentar risco temporario com mitigacoes.

Nota alvo: 88+.

### Frente E: QA full-cycle e performance

Objetivo: fazer o ciclo passar de verdade.

Entregas:

- Health check do script valida payload.
- Redis health check usa metodo correto para Redis, nao fetch HTTP.
- Stress p95 passa no threshold definido ou threshold e revisto formalmente.
- `qa:full-cycle:archive` gera evidencia com `scenario_passed=true`.

Nota alvo: 96.

### Frente F: Documentacao e governanca de escopo

Objetivo: alinhar documentos ao estado real.

Entregas:

- Atualizar roadmaps 72/73/75 depois da correcao.
- Criar matriz de escopo para modulos extras.
- Classificar `contacts`, `labels`, `sectors`, `transfers`, `contact-groups`, `kanban`.
- Marcar scores antigos como historicos quando nao refletirem o estado atual.

Nota alvo: 90+.

## 6. Plano por fases

| Fase | Objetivo | Duracao estimada | Saida esperada |
|---|---|---:|---|
| Fase 1 | Desbloquear gates centrais | 1-2 dias | build/lint/typecheck passam |
| Fase 2 | Estabilizar testes | 1-2 dias | `pnpm test` passa |
| Fase 3 | Corrigir seguranca | 1-2 dias | audit sem high e com plano residual |
| Fase 4 | Fechar QA full-cycle | 1 dia | `scenario_passed=true` |
| Fase 5 | Reconciliar documentacao | 0.5-1 dia | docs refletem evidencia real |

## 7. Riscos

| Risco | Impacto | Mitigacao |
|---|---|---|
| Ciclo chat/gateway esconder acoplamento profundo | Alto | Extrair contratos e isolar outbound adapter. |
| Dependencias novas quebrarem Fastify/Vite | Medio | Atualizar em branches pequenos e rodar suites por pacote. |
| Testes dependerem de banco sujo | Alto | Fixtures com nomes unicos, cleanup idempotente e isolamento. |
| P95 exigir otimizacao real | Medio | Medir endpoints mais lentos antes de relaxar threshold. |
| Modulos extras puxarem CRM fora de escopo | Medio | Matriz formal de escopo antes de novas features. |

## 8. Indicadores de progresso

| Indicador | Alvo |
|---|---:|
| Build raiz | PASS |
| Lint raiz | PASS |
| Typecheck raiz | PASS |
| Test raiz | PASS |
| Desk API tests | 0 falhas |
| Vulnerabilidades high | 0 |
| QA full-cycle scenario_passed | true |
| p95 stress | abaixo do threshold aprovado |
| Docs de score | atualizados apos evidencia |

## 9. Recomendacao imediata

Comecar pela dependencia circular. Ela bloqueia build/lint e e tambem um sinal de fronteira arquitetural ruim entre Chat Core e Gateway Adapter. Enquanto esse ciclo existir, qualquer auditoria de arquitetura deve continuar penalizando o projeto.
