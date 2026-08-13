# Backlog de Melhorias Necessarias

**Data:** 2026-04-27  
**Relatorio base:** `docs/76-relatorio-auditoria-escopo-estado-atual.md`  
**Roadmap:** `docs/78-roadmap-melhorias-necessarias.md`

> Atualizacao de fechamento: backlog P0/P1/P2 executado em 2026-04-27. O estado final, notas por item, matriz de escopo, decisao de token, health/readiness e coverage critico estao consolidados em `docs/80-fechamento-execucao-p0-p1-p2.md`.

## Convencoes

| Prioridade | Significado |
|---|---|
| P0 | Bloqueia score 96/100 e prontidao operacional |
| P1 | Importante para seguranca, confiabilidade ou governanca |
| P2 | Acabamento, reducao de risco residual ou melhoria de DX |

## P0 - Gates centrais

### B1 - Quebrar dependencia circular `@cvg/chat` <-> `@cvg/gateway-adapter`

**Status:** pendente  
**Area:** arquitetura/build  
**Evidencia atual:** `pnpm run build` e `pnpm run lint` falham por ciclo.

#### Tarefas

- Mapear imports reais entre `chat` e `gateway-adapter`.
- Extrair tipos/contratos compartilhados para modulo neutro.
- Remover dependencia concreta de `gateway-adapter` dentro de `chat`.
- Garantir que outbound use interface/porta injetavel.
- Atualizar testes afetados.

#### Critérios de aceite

- `pnpm run build` nao falha por ciclo.
- `pnpm run lint` nao falha por ciclo.
- `@cvg/chat` nao depende diretamente de `@cvg/gateway-adapter`.
- `@cvg/gateway-adapter` nao importa use cases de `@cvg/chat`.

#### Nota esperada apos conclusao

- Arquitetura modular: 68 -> 82.
- Build/lint: 45 -> 75.

### B2 - Tornar `pnpm run typecheck` funcional

**Status:** pendente  
**Area:** TypeScript/CI  
**Evidencia atual:** `turbo run typecheck` falha por task ausente.

#### Tarefas

- Adicionar script `typecheck` nos pacotes runtime.
- Adicionar task `typecheck` no `turbo.json`.
- Definir se pacotes com `echo build` devem usar `tsc --noEmit`.
- Rodar `pnpm run typecheck`.

#### Critérios de aceite

- `pnpm run typecheck` passa.
- Falhas de tipo quebram CI/local.
- Scripts placeholders nao mascaram erro real.

### B3 - Corrigir falhas de `@cvg/desk-api test`

**Status:** pendente  
**Area:** testes/API  
**Evidencia atual:** 5 falhas, 102 passes, 3 skipped.

#### Tarefas

- Corrigir seed/login em `rate-limit.integration.test.ts`.
- Corrigir conflito `CORS_ORIGIN` vs teste de webhook em producao.
- Corrigir fixture de role `Admin` duplicada em dashboard KPI.
- Corrigir cleanup com UUID vazio em webhook security stats.
- Corrigir expectativa de telefone em contacts.
- Reexecutar suite API.

#### Critérios de aceite

- `pnpm --filter @cvg/desk-api test` passa.
- `pnpm test` passa na raiz.
- Nenhum teste skipped sem justificativa documentada.

### B4 - Corrigir `qa:full-cycle` para validar health real

**Status:** pendente  
**Area:** QA/runtime  
**Evidencia atual:** script aceitou HTTP 200 com payload `status:"error"`.

#### Tarefas

- Parsear resposta de `/health`.
- Exigir `status === "ok"` para prosseguir.
- Imprimir checks com PASS/FAIL.
- Falhar quando dependencia obrigatoria estiver em erro.

#### Critérios de aceite

- Health com `status:"error"` faz o ciclo falhar antes dos testes/stress.
- Health com `status:"degraded"` tem regra documentada.
- Log mostra motivo exato da falha.

### B5 - Corrigir Redis health check

**Status:** pendente  
**Area:** runtime  
**Evidencia atual:** API tenta `fetch(http://redis:6379/)`.

#### Tarefas

- Substituir check HTTP por socket TCP, cliente Redis ou ping real.
- Atualizar teste de health/readiness.
- Validar em Docker Compose.

#### Critérios de aceite

- `/health` com Redis saudavel retorna Redis `ok`.
- `/health` com Redis indisponivel retorna erro coerente.
- `qa:full-cycle` nao registra falso erro de Redis.

### B6 - Fazer `qa:full-cycle` passar thresholds

**Status:** pendente  
**Area:** performance/QA  
**Evidencia atual:** p95 431.08ms contra threshold 200ms.

#### Tarefas

- Identificar endpoints mais lentos no stress.
- Verificar overhead de auth, database e health.
- Otimizar consultas ou setup do teste.
- Reexecutar com threshold padrao.
- Se threshold for alterado, registrar decisao tecnica.

#### Critérios de aceite

- `scenario_thresholds.scenario_passed=true`.
- p95 abaixo do threshold aprovado.
- Error rate 5xx <= 1%.
- Checks rate >= 99%.

## P0 - Seguranca

### B7 - Resolver vulnerabilidades high do `pnpm audit`

**Status:** pendente  
**Area:** security/supply chain  
**Evidencia atual:** 14 vulnerabilidades, 2 high.

#### Tarefas

- Atualizar `fastify` para versao corrigida.
- Verificar compatibilidade de plugins Fastify.
- Reexecutar testes API.
- Registrar vulnerabilidades remanescentes.

#### Critérios de aceite

- Nenhuma vulnerabilidade high no audit.
- Aplicacao compila e testes passam.

### B8 - Tratar moderates de Vite/esbuild/postcss/follow-redirects/static/uuid

**Status:** pendente  
**Area:** security/supply chain

#### Tarefas

- Atualizar Vite e cadeia esbuild/postcss.
- Atualizar axios/follow-redirects.
- Atualizar ou substituir uuid vulneravel.
- Atualizar swagger-ui/static se houver versao corrigida.

#### Critérios de aceite

- `pnpm audit --audit-level moderate` passa ou possui excecoes documentadas.
- Nenhuma excecao sem prazo/responsavel.

### B9 - Decidir estrategia de armazenamento de token

**Status:** pendente  
**Area:** auth/security/frontend

#### Tarefas

- Avaliar migracao para cookie `HttpOnly`, `Secure`, `SameSite`.
- Se migrar, atualizar login/logout/API client.
- Se nao migrar agora, documentar risco e mitigacoes.

#### Critérios de aceite

- Decisao registrada em documento de seguranca.
- Testes de auth frontend/API atualizados.
- Risco residual explicito.

## P1 - Governanca de escopo

### B10 - Criar matriz de escopo dos modulos extras

**Status:** pendente  
**Area:** produto/documentacao

#### Modulos a classificar

- `contacts`
- `labels`
- `sectors`
- `transfers`
- `contact-groups`
- `kanban`

#### Critérios de aceite

- Cada modulo classificado como `MVP`, `adjacente permitido`, `futuro` ou `fora de escopo`.
- Qualquer modulo fora do MVP tem justificativa operacional.
- Nao ha expansao para CRM completo, BI avancado ou HIS.

### B11 - Atualizar documentos de score antigos

**Status:** pendente  
**Area:** documentacao

#### Tarefas

- Atualizar `docs/72-roadmap-98-porcento.md`.
- Atualizar `docs/73-backlog-98-porcento.md`.
- Atualizar `docs/75-roadmap-98-porcento.md`.
- Marcar relatorios antigos como historicos quando divergirem.

#### Critérios de aceite

- Nenhum documento afirma 96/100 sem evidencia executada.
- Estado atual e plano de recuperacao ficam claros.

### B12 - Documentar criterio de health/readiness

**Status:** pendente  
**Area:** operacao/documentacao

#### Tarefas

- Definir diferenca entre `/health` e `/readiness`.
- Definir quando `degraded` e aceitavel.
- Definir dependencias obrigatorias por ambiente.

#### Critérios de aceite

- Runbook claro para local, staging e producao.
- `qa:full-cycle` segue o runbook.

## P1 - Testes e qualidade

### B13 - Reduzir skips em testes de API

**Status:** pendente  
**Area:** QA

#### Tarefas

- Revisar 3 testes skipped em `@cvg/desk-api`.
- Corrigir fixtures ou marcar explicitamente como pendencia.

#### Critérios de aceite

- 0 skips injustificados.
- Skips remanescentes possuem issue/backlog.

### B14 - Criar coverage global por pacote critico

**Status:** pendente  
**Area:** QA

#### Pacotes criticos

- `@cvg/desk-api`
- `@cvg/chat`
- `@cvg/auth`
- `@cvg/events`
- `@cvg/tasks`
- `@cvg/desk-web`

#### Critérios de aceite

- Coverage report por pacote.
- Meta minima definida por pacote.
- Tasks mantem >90%.

### B15 - Estabilizar banco de testes

**Status:** pendente  
**Area:** QA/database

#### Tarefas

- Fixtures idempotentes.
- Cleanup tolerante a setup parcial.
- Evitar nomes globais como `Admin` sem `on conflict`.

#### Critérios de aceite

- Suites podem rodar repetidamente no mesmo banco.
- Rodadas paralelas nao quebram por dados compartilhados.

## P2 - Acabamento operacional

### B16 - Remover `version` obsoleto dos docker-compose

**Status:** pendente  
**Area:** DX/runtime

#### Critérios de aceite

- Docker Compose nao emite warning de atributo obsolete.

### B17 - Revisar scripts raiz `db:migrate` e `db:seed`

**Status:** pendente  
**Area:** DX/database

#### Problema

- Scripts raiz ainda imprimem `not implemented yet`.

#### Critérios de aceite

- Scripts apontam para `@cvg/database` ou sao removidos/documentados.

### B18 - Melhorar saida de logs dos testes

**Status:** pendente  
**Area:** QA/DX

#### Critérios de aceite

- Logs de erro esperados em testes nao poluem output como falha operacional.
- Testes continuam assertivos.

## Ordem recomendada de execucao

1. B1 - Quebrar dependencia circular.
2. B2 - Typecheck real.
3. B3 - Corrigir testes API.
4. B7 - Resolver vulnerabilidades high.
5. B4/B5 - Corrigir health e Redis.
6. B6 - Fechar `qa:full-cycle`.
7. B10/B11 - Reconciliar escopo e documentacao.
8. B8/B9/B13-B18 - Fechar riscos residuais.

## Comandos de validacao final

```bash
pnpm run build
pnpm run lint
pnpm run typecheck
pnpm test
pnpm audit --audit-level moderate
TEARDOWN=1 pnpm run qa:full-cycle:archive
```

## Definicao de pronto para 96/100

O projeto so volta a ser classificado como 96/100 quando:

- todos os comandos finais passarem;
- `scenario_passed=true`;
- vulnerabilidades high forem zero;
- skips forem justificados ou eliminados;
- documentacao refletir a evidencia mais recente;
- escopo de modulos extras estiver formalizado.
