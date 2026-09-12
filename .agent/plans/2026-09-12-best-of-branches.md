# Consolidação seletiva dos branches — ExecPlan

## Purpose / Big Picture

Unificar em `main` somente as melhorias que aumentem o produto sem regredir a linha atual de segurança, persistência, eventos, realtime, observabilidade, DR e CI. O resultado observável será um monorepo único, compilável e testado, com os recursos úteis dos branches alternativos integrados às interfaces atuais e com evidência de que autenticação, autorização, dados e fluxos existentes continuam funcionando.

## Progress

- [x] (2026-09-12T11:03:31-03:00) Estado de `main`, instruções, histórico e referências remotas inspecionados.
- [x] (2026-09-12T11:03:31-03:00) Baseline de `main` executado com `pnpm test`: 31 pacotes bem-sucedidos; aviso de dependência circular registrado.
- [x] (2026-09-12T11:03:31-03:00) Referência de recuperação criada em `backup/main-before-branch-unification`.
- [x] (2026-09-12T11:12:00-03:00) Comparação funcional e de risco dos dois branches alternativos concluída; matriz de decisão registrada.
- [x] (2026-09-12T12:02:00-03:00) Melhorias selecionadas integradas em branch de consolidação, com adaptação de contratos e correções de segurança/runtime.
- [x] (2026-09-12T12:18:00-03:00) Critérios de aceitação e regressão executados: focos de domínio, dashboard, worker, realtime, API e frontend verdes; gate amplo limitado pelo PostgreSQL local.
- [x] (2026-09-12T12:18:00-03:00) Revisão adversarial separada concluída; ACK/cursor e overlap do polling HTTP foram corrigidos, cobertura UI adicionada e artefatos de entrega revisados.
- [x] (2026-09-12T12:20:00-03:00) Commit consolidado criado na branch de integração; candidato pronto para fast-forward seguro de `main` e push autorizado.

## Surprises & Discoveries

- Observation: `main` está limpo e é descendente de `373ab40`, enquanto os dois branches remotos divergem de bases mais antigas.
  Evidence: `git log --graph --all --decorate --oneline`; `git merge-base origin/main origin/agent/plan-95-delivery`; `git merge-base origin/main origin/codex-finalizar-plano-85-e-readme`.
  Impact: uma mesclagem integral carregaria implementações antigas sobre hardenings posteriores; a estratégia deve ser port seletivo e adaptado.

- Observation: a linha atual já possui tabelas `tutors` e `patients`, migrações de referência e campos relacionados, mas não possui os módulos/rotas/ telas dedicados.
  Evidence: `packages/database/src/schema.ts`; `packages/database/supabase/migrations/0001_chat_core.sql`; ausência de `modules/patients` e `modules/tutors` em `main`.
  Impact: o recurso pode ser integrado sem nova alteração de schema, mas precisa de validação de relacionamentos e autorização.

- Observation: o branch `agent/plan-95-delivery` contém hardenings e testes úteis, porém também reescreve componentes centrais em versões anteriores e apresenta whitespace problemático no diff.
  Evidence: `git diff --check origin/main..origin/agent/plan-95-delivery`; diffs de `apps/desk-api/src/app.ts`, `apps/realtime-service/src/index.ts` e `apps/message-worker/src/index.ts`.
  Impact: nenhuma substituição integral desse branch é autorizada; cada melhoria precisa ser comparada ao equivalente atual.

- Observation: o branch `codex-finalizar-plano-85-e-readme` acrescenta Tutor/Paciente e um dashboard premium, mas o SQL de métricas e alguns detalhes de domínio precisam ser corrigidos antes de uso.
  Evidence: arquivos `modules/patients/**`, `modules/tutors/**`, `modules/dashboard/src/application/use-cases/get-premium-dashboard.use-case.ts` no branch; inspeção do cálculo de conversas do paciente.
  Impact: preservar a intenção funcional, reimplementar os pontos frágeis na arquitetura atual e adicionar testes de contrato.

- Observation: os serviços de API, worker e realtime executam o código-fonte via `tsx` nas imagens atuais; com `pnpm --prod`, `tsx` precisava ser dependência de runtime.
  Evidence: comandos dos Dockerfiles e scripts `CMD` das três imagens; typecheck/build dos serviços.
  Impact: `tsx` foi movido para `dependencies` e as imagens mantêm instalação somente de produção, sem carregar dependências de teste no runtime.

- Observation: a validação integral do monorepo continua limitada pelo ambiente local, não pelo código selecionado.
  Evidence: PostgreSQL em `127.0.0.1:5432` rejeita a senha do usuário `connect_desk`; o daemon Docker não permite acesso ao socket; Turbo acusa o ciclo pré-existente `@cvg/chat` ↔ `@cvg/gateway-adapter`.
  Impact: testes focais, typechecks, builds e testes realtime foram executados; suítes dependentes de banco/container e gates Turbo foram registrados como limitações, sem declarar PASS falso.

- Observation: o fallback HTTP do realtime precisava confirmar cada evento antes de avançar o cursor; o branch candidato apenas lia `/events` e não fechava o ciclo de ACK.
  Evidence: teste adversarial com API HTTP falsa inicialmente não observou ACK nem requisição subsequente com `since`; a implementação final envia o header interno, chama o endpoint de ACK e só atualiza `lastServerTime` após todos os ACKs.
  Impact: o fluxo consolidado evita perda lógica após resposta parcial e bloqueia overlap enquanto um ciclo HTTP ainda está processando.

### Branch decision matrix

| Candidate | Decision | Improvement/area | Evidence and risk judgment |
| --- | --- | --- | --- |
| `origin/codex-finalizar-plano-85-e-readme` | ADAPT | Tutor/Paciente CRUD, relationships, API clients, routes and screens | Functional gap confirmed in `main`; branch module is a usable starting point, but patient conversation count incorrectly compares `conversations.contactId` with `patients.tutorId`, mutations lack complete authorization/input handling, and delete conflicts are not surfaced. |
| `origin/codex-finalizar-plano-85-e-readme` | ADAPT | Operational dashboard KPIs | Response-time, handoff, sector backlog, aging and alert criticality are useful additions; branch SQL has an uncorrelated outbound lateral query and unbounded `limit`, so it cannot be copied verbatim. Existing summary endpoints must remain unchanged. |
| `origin/agent/plan-95-delivery` | PORT SELECTIVELY | Explicit `TRUST_PROXY` resolution | Current `main` uses `trustProxy: true`, which makes client IP/rate-limit attribution spoofable outside a trusted proxy boundary. Port the resolver and production fail-closed rule without the branch's unrelated app rewrite. |
| `origin/agent/plan-95-delivery` | PORT SELECTIVELY | Internal authentication for `/events` polling | Current `/events` and ACK endpoints are not authenticated while the branch supplies constant-time service-key validation. Port the guard, wire the realtime fallback and compose/env secret, and test missing/invalid/valid key paths. |
| `origin/agent/plan-95-delivery` | PORT SELECTIVELY | Worker no-overlap polling and health endpoint | Current worker uses an async `setInterval` with no overlap guard and has a separate healthcheck process; the branch's small `createNoOverlapPoller` and health server address an operational race. Adapt to current logger/dead-letter contracts and add lifecycle coverage. |
| `origin/agent/plan-95-delivery` | REJECT WHOLESALE | Full `app.ts`, auth-cookie/CSRF and realtime rewrites | The branch replaces current bearer-session, HMAC, outbox, Redis fan-out, readiness and media behavior with older/incompatible variants. Whole-file adoption would remove or regress controls already present in `main`. |
| `origin/agent/plan-95-delivery` | REJECT | Response cache, alerting rewrite and redundant quality workflow | Cache semantics are unsafe without tenant/auth/request variation; alerting adds external side effects not required by this consolidation; `quality-gates.yml` calls a missing `ci:gates` script and duplicates newer pinned workflows. |
| Both branches | REJECT WHOLESALE | Bulk docs, generated scorecards, duplicate workflows and old UI rewrites | Current `main` has newer release evidence and hardening. Large branch diffs contain stale/deleted documents, whitespace failures and implementation rewrites unrelated to the selected product gaps. |

## Decision Log

- Decision: manter `origin/main` como base canônica e usar cópia seletiva de comportamento, não merge cego dos branches.
  Context: os branches carregam histórico divergente e versões antigas de segurança, realtime e infraestrutura.
  Alternatives: merge integral; cherry-pick dos commits inteiros; port de arquivos e testes selecionados.
  Reason: o port seletivo preserva a linha mais recente e permite validar cada contrato na base real.
  Consequences: mais trabalho de adaptação, porém menor risco de regressão e histórico final mais coerente.
  Date/Author: 2026-09-12 / Codex

- Decision: preservar o hardening atual de `main` como requisito de não regressão.
  Context: `main` contém HMAC/anti-replay, autorização setorial, sessões com hash, mídia/quarentena, DLQ persistente, OTel, fan-out Redis, DR e gates de CI.
  Alternatives: aceitar a implementação do branch mais novo em cada arquivo; escolher por tamanho do diff.
  Reason: segurança, integridade de dados e recuperação têm prioridade sobre conveniência ou quantidade de features.
  Consequences: melhorias antigas só entram se forem reescritas/adaptadas e cobertas por evidência atual.
  Date/Author: 2026-09-12 / Codex

- Decision: qualquer mudança de schema, migração destrutiva, credencial ou produção fica fora desta execução sem autorização específica.
  Context: a consolidação deve ser reversível e local; os dados reais não estão no escopo.
  Alternatives: executar migração real durante a integração; aceitar implicitamente compatibilidade de produção.
  Reason: não há autoridade nem necessidade para mutar dados reais; o modelo já contém as tabelas necessárias.
  Consequences: migrações novas somente se forem comprovadamente necessárias e expandidas, com teste em banco descartável.
  Date/Author: 2026-09-12 / Codex

## Outcomes & Retrospective

Consolidação funcional concluída na branch `integration/best-of-branches`, com commit candidato pronto para fast-forward seguro de `main` e publicação autorizada.

Incorporado: módulos Tutor/Paciente com CRUD protegido, validação, relacionamentos e telas; dashboard premium com resposta, handoff, backlog, aging e criticidade; `TRUST_PROXY` fail-secure; autenticação do polling interno; ACK/cursor e no-overlap no realtime HTTP/outbox; polling no-overlap e health endpoint do worker; dependência de runtime `tsx`; marcador `senderType=human` para outbound; correções de typecheck e documentação/env/compose.

Rejeitado: merge integral dos branches, reescritas antigas de `app.ts`, auth-cookie/CSRF/realtime, cache/alerting/workflow redundante e documentação/UI obsoleta. A linha atual de bearer/session, HMAC, outbox, Redis, mídia, DLQ, OTel, DR e CI foi preservada.

Evidência atual: Tutor/Paciente 4 testes cada com typecheck/build; dashboard 12 testes com typecheck/build; worker 11 testes com typecheck/build; realtime 76 testes com typecheck/build; desk-web 47 testes com typecheck/build; API estrutural/auth 20 testes; compose dev/staging/produção validável; `git diff --check` verde.

Limitações: `pnpm test` executou 33 tarefas e teve 14 sucessos, mas as suítes de integração/real-DB falharam em `28P01` por credencial local; Docker não pôde ser usado por permissão no socket; lint do frontend permanece bloqueado por 32 warnings `no-explicit-any` preexistentes; o ciclo Turbo `@cvg/chat` ↔ `@cvg/gateway-adapter` continua pré-existente. Nenhum desses resultados será reportado como PASS global.

## Context and Orientation

O projeto é um monorepo pnpm/Turborepo com API Fastify em `apps/desk-api`, frontend React/Vite em `apps/desk-web`, worker de eventos, serviço realtime, módulos de domínio em `modules/` e pacotes compartilhados em `packages/`. `main` é a linha mais nova e já passa pelo teste turbo local. O branch `origin/agent/plan-95-delivery` é uma entrega monolítica de hardening/testes baseada em `373ab40`; `origin/codex-finalizar-plano-85-e-readme` é uma linha de produto premium baseada em uma base anterior e contém telas/rotas de Tutor/Paciente e KPIs adicionais.

## Scope and Constraints

- In scope: comparar branches locais/remotos, selecionar melhorias comprováveis, adaptar módulos de Tutor/Paciente e KPIs que sejam compatíveis, atualizar contratos/telas/testes/documentação necessária e entregar `main` verificado.
- Out of scope: apagar branches, reescrever histórico remoto, trocar a arquitetura de segurança atual, executar migração em dados reais, publicar credenciais, declarar certificação de produção ou incorporar documentação duplicada/obsoleta.
- Applicable instructions: `/home/ricardo/.agents/skills/engineering-framework/SKILL.md` e referências carregadas de auditoria, gates, execução, testes, segurança, risco, migração e estado; não foi encontrado `AGENTS.md` no repositório.
- Requirements/decisions: intenção do usuário de preservar as melhores melhorias e unificar tudo de forma coerente; critérios deste plano e contratos existentes em `README.md`, `docs/`, `package.json` e workflows.
- Tier/risk/blast radius: `T3_SYSTEM`, risco `HIGH`, raio `SYSTEM`; a mudança atravessa API, frontend, dados, testes, CI e integrações internas.
- Authorization constraints: push para o repositório é autorizado pelo pedido; ações destrutivas, produção, credenciais, dados reais e aceitação de risco residual alto continuam fora sem decisão humana explícita.

## Architecture and Interfaces

Preservar o fluxo atual `React/Vite → desk-api → módulos de domínio → Drizzle/PostgreSQL`, com eventos persistidos em outbox, worker e realtime por polling/Redis. A API registra módulos no `apps/desk-api/src/app.ts` e protege rotas com `authenticate`, `requirePermission` e, quando aplicável, escopo setorial. As tabelas `tutors`, `patients`, `contacts`, `conversations` e `tasks` já existem no schema atual. O dashboard atual expõe `/metrics/summary` e métricas derivadas; extensões devem manter compatibilidade desses endpoints e garantir que cada métrica agregue a conversa correta, sem N+1 ou vazamento de escopo. O frontend mantém `App.tsx`, `Layout.tsx`, `lib/api.ts` e páginas CSS como pontos canônicos.

## Milestones

### Milestone 1 — Matriz de decisão dos branches

- Outcome: uma lista rastreável de melhorias aceitas, adaptadas ou rejeitadas por branch, arquivo, risco e evidência.
- Scope/dependencies: referências remotas, histórico, diffs, manifests, testes e baseline de `main`.
- Demonstration: comandos de comparação e inspeção reproduzíveis, sem mutar código de produto.
- Acceptance/evidence: matriz registrada neste plano e branch de integração criado a partir do backup/base atual.

### Milestone 2 — Domínio Tutor/Paciente integrado

- Outcome: rotas autenticadas, CRUD coerente, relacionamento tutor-paciente e telas acessíveis no frontend, com os campos já existentes no banco.
- Scope/dependencies: `modules/patients`, `modules/tutors`, registro no API, `apps/desk-web`, testes de API/módulo/UI.
- Demonstration: typecheck, testes focais e smoke de rotas com banco descartável quando disponível.
- Acceptance/evidence: casos allow/deny, validação de entrada, not-found, conflito, relacionamento e regressão do app atual.

### Milestone 3 — Dashboard operacional superior

- Outcome: KPIs de resposta, handoff, backlog por setor, alertas ativos e aging integrados ao dashboard sem substituir o resumo existente.
- Scope/dependencies: use cases/repository/dashboard controller, tipos de API, tela Dashboard e testes SQL/endpoint/UI.
- Demonstration: dados sintéticos com respostas determinísticas e verificação dos valores agregados.
- Acceptance/evidence: métrica por conversa correta, limites de aging, escopo de setor, fallback de falha e ausência de N+1.

### Milestone 4 — Verificação e entrega

- Outcome: consolidação limpa, documentada e pronta para push, com regressão credível e revisão adversarial separada.
- Scope/dependencies: lint/typecheck/build/test, inspeção de diff, workflows e documentação final.
- Demonstration: comandos reais executados e estado Git limpo/sincronizado.
- Acceptance/evidence: sem bloqueio conhecido, limitações declaradas e commit/push autorizado apenas após validação.

## Plan of Work

Concluir a matriz de branches e criar uma branch de integração sobre a linha atual. Portar primeiro os limites de domínio e os testes que podem detectar regressões; depois integrar módulos de Tutor/Paciente usando os campos já existentes, corrigindo validação, autorização de escrita e contagens relacionais. Em seguida portar a intenção dos KPIs premium para consultas corretas e compatíveis com o dashboard atual, evitando copiar o SQL antigo sem teste. Integrar apenas testes, scripts ou documentação do branch de hardening quando não duplicarem controles já mais novos. Rodar validação focal após cada fatia, uma suíte de regressão após a integração e uma revisão adversarial temporalmente separada antes de atualizar `main` e publicar.

## Concrete Steps

From `/home/ricardo/cvg-connect-desk`:

1. [x] [branch-unification:integrate-domain] Portar e adaptar os módulos Tutor/Paciente, contratos de API, registro de rotas, telas e testes; não adicionar migração sem necessidade demonstrada.
2. [x] [branch-unification:integrate-dashboard] Portar/adaptar os KPIs premium com consultas corretas, tipos compatíveis, limites validados e testes de dados sintéticos.
3. [x] [branch-unification:integrate-hardening] Selecionar e adaptar `TRUST_PROXY`, autenticação do polling interno e proteção contra overlap/health do worker, mantendo os contratos atuais.
4. [x] [branch-unification:verify] Rodar testes focais, typecheck, lint, build, `pnpm test`, `git diff --check` e os smoke/integration checks disponíveis; guardar resultados e limitações.
5. [x] [branch-unification:review-delivery] Fazer revisão adversarial separada, corrigir o maior gap, inspecionar o diff final e criar o commit de consolidação; o fast-forward/push de `origin/main` é a ação de entrega seguinte.

## Validation and Acceptance

| Criterion | Required | Procedure/environment | Expected observation | Evidence destination |
| --- | --- | --- | --- | --- |
| `BR-001-BASE-CURRENT` | YES | `git diff --check`, `pnpm test` em `main` e inspeção dos refs | baseline atual reproduzível; regressões novas distinguíveis | plano + saída dos comandos |
| `BR-002-BRANCH-DECISION` | YES | `git log`, `git diff`, inspeção de manifests e testes dos candidatos | cada melhoria aceita/rejeitada tem motivo e evidência | Decision Log / Surprises |
| `BR-003-AUTH-DOMAIN` | YES | testes API/módulo para leitura, escrita, input inválido, 401/403/404 e conflitos | rotas protegidas e erros estáveis; nenhuma autorização só na UI | testes focais |
| `BR-004-DATA-RELATIONS` | YES | testes com banco descartável ou integração disponível | tutor/paciente e contagens respeitam IDs/relacionamentos; sem alteração destrutiva | testes de integração |
| `BR-005-DASHBOARD-KPIS` | YES | testes de use case/endpoint com dados sintéticos | métricas calculam a conversa/setor correto e limites determinísticos | testes de dashboard |
| `BR-006-FRONTEND-CONTRACT` | YES | `pnpm --filter @cvg/desk-web typecheck`, build e testes UI | rotas, API clients e estados de erro compilam e renderizam | build/test output |
| `BR-007-REGRESSION` | YES | `pnpm test`, typecheck, lint, build e smoke aplicável | nenhuma falha nova no monorepo; limitações explícitas | `.agent` evidence / terminal |
| `BR-008-REVIEW-DELIVERY` | YES | revisão adversarial separada + `git status` + diff final | gaps bloqueadores fechados; árvore limpa; push somente do candidato verificado | revisão final / Git |

## Risks and Human Decisions

| Risk/decision | Evidence/confidence | Controls | Residual/authority | Trigger |
| --- | --- | --- | --- | --- |
| Regressão de segurança ao portar código antigo | diffs de `app.ts`, auth e realtime; HIGH confidence | basear em `main`, port seletivo, testes 401/403/anti-replay e revisão | não aceitar residual HIGH sem autoridade | qualquer controle atual removido ou enfraquecido |
| Relação tutor/paciente incompatível com dados existentes | schema e migrações confirmam tabelas; MEDIUM confidence | queries com IDs corretos, FK já existente, testes sintéticos e erro de conflito | sem migração nova até prova de necessidade | coluna/tabela ausente no banco de teste |
| KPI premium incorreto ou caro | SQL antigo tem junções frágeis; HIGH confidence | queries correlacionadas, agregações, teste de valores e inspeção de N+1 | residual desconhecido se só houver unit mock | discrepância de contagem/latência |
| CI duplicado ou obsoleto | workflows atuais já cobrem gates; HIGH confidence | não copiar workflow sem lacuna demonstrada; validar lockfile | não aplicável | gate novo duplicar ou relaxar um existente |
| Dados reais/produção afetados | nenhum acesso necessário; HIGH confidence | somente banco descartável/local, sem secrets, sem comandos destrutivos | ação de produção requer autoridade humana | necessidade de deploy/migração/credencial |

## Idempotence and Recovery

Todas as mudanças serão feitas em branch de integração e podem ser repetidas após `git status`/diff limpos. A referência `backup/main-before-branch-unification` preserva a base; branches remotos não serão apagados. Se uma fatia falhar, manter o artefato e registrar o diagnóstico, corrigir de forma coerente e repetir o check focal. Para abandonar a consolidação, retornar a `main` limpa e remover somente a branch local de integração se isso for necessário e seguro; nunca usar `reset --hard` ou `checkout --` sobre trabalho do usuário. Como o modelo Tutor/Paciente já está presente, não há cutover de dados planejado; qualquer migração inevitável exige expansão compatível, teste descartável, verificação de integridade e decisão separada.

## Artifacts and Evidence

- `.agent/plans/2026-09-12-best-of-branches.md`: plano vivo, decisões, riscos, critérios e recuperação.
- `backup/main-before-branch-unification`: referência local de recuperação da linha estável antes da consolidação.
- `origin/main`, `origin/agent/plan-95-delivery`, `origin/codex-finalizar-plano-85-e-readme`: refs comparados; preservados no remoto.
- `pnpm test`, typecheck, lint, build e testes focais: evidência de execução, sempre reportada com limitações reais.

Plan revision note, 2026-09-12: plano criado após baseline de `main`, fetch remoto e inspeção inicial; próxima ação é fechar a matriz de decisão dos candidatos.
