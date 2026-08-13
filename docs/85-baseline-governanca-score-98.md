# Baseline e Governanca do Score 98

**Data:** 2026-04-28  
**Fonte de verdade:** `docs/82-plano-executivo-98-todos-itens.md`, `docs/83-roadmap-98-todos-itens.md`, `docs/84-backlog-98-todos-itens.md`  
**Escopo executado:** P0 - Baseline e governanca do score (`B98-01` e `B98-02`).  
**Resultado:** baseline tecnico executado e matriz de scoring criada. Os gates funcionais passam, mas o baseline confirma lacunas que impedem declarar todos os itens em 98/100.

## 1. Status executivo

| Item P0 | Status | Evidencia |
|---|---|---|
| `B98-01` - Criar matriz de scoring 98 por item | Concluido | Secao 4 deste documento. |
| `B98-02` - Reexecutar baseline tecnico atual | Concluido | Secao 2 deste documento. |

Leitura executiva:

- O projeto continua operavel nos gates principais: lint, build, typecheck, test e audit passam.
- A nota ainda nao pode subir para 98/100 porque o coverage critico esta abaixo de 80% em varios pacotes e o comando de coverage ainda nao bloqueia regressao.
- O typecheck atual passa, mas cobre 7 pacotes criticos, nao o workspace completo.
- A sessao web ainda consulta token em `localStorage`, confirmando a necessidade da frente HttpOnly/CSRF.
- `pnpm install --frozen-lockfile` nao reportou warnings nesta rodada, mas a politica de dependencias transitivas continua necessaria para sustentacao.

## 2. Baseline tecnico executado

| Comando | Resultado | Evidencia objetiva | Leitura para score 98 |
|---|---:|---|---|
| `pnpm run lint` | PASS | 27/27 pacotes; sem warnings reportados. | Mantem `Lint e warnings de manutencao` em 100. |
| `pnpm run build` | PASS | 27/27 pacotes; `@cvg/desk-web` com `vite v7.3.2` sem warning de deprecacao. | Mantem `Build` em 100 e `Tooling frontend/Vite` em 100. |
| `pnpm run typecheck` | PASS | 7/7 pacotes no escopo atual: `desk-web`, `message-worker`, `realtime-service`, `dashboard`, `realtime`, `events`, `database`. | Nao basta para 98; precisa expandir para workspace completo. |
| `pnpm run test` | PASS | 27/27 pacotes. | Mantem suite funcional verde; precisa reforcar fluxos abaixo de coverage. |
| `pnpm run test:coverage:critical` | PASS tecnico | O comando terminou com exit 0, mas pacotes criticos ficaram abaixo de 80%. | Gate precisa aplicar thresholds reais antes de score 98. |
| `pnpm audit --audit-level moderate` | PASS | `No known vulnerabilities found`. | Vulnerabilidades conhecidas estao zeradas no audit. |
| `pnpm install --frozen-lockfile` | PASS | Lockfile ja estava atualizado; sem warnings nesta execucao. | Nao ha warning novo nesta rodada; manter politica de revisao. |

## 3. Baseline de coverage critico

| Pacote | Tests | Statements | Status para 98 |
|---|---:|---:|---|
| `@cvg/desk-api` | 110 passed | 49.01% | Bloqueia 98; precisa >= 80%. |
| `@cvg/chat` | 39 passed | 41.40% | Bloqueia 98; precisa >= 80%. |
| `@cvg/auth` | 26 passed | 71.21% | Bloqueia 98; precisa >= 80% e cobrir `sector-permissions`. |
| `@cvg/events` | 133 passed | 48.56% | Bloqueia 98; precisa >= 80%. |
| `@cvg/tasks` | 70 passed | 96.69% | Apto para 98; manter gate. |
| `@cvg/desk-web` | 41 passed | 36.46% | Bloqueia 98; precisa cobrir paginas operacionais. |

Conclusao de governanca: `pnpm run test:coverage:critical` deve deixar de ser apenas um agregador de relatorios e passar a falhar quando qualquer pacote critico ficar abaixo do minimo aprovado. Isso ja esta mapeado em `B98-07`.

## 4. Matriz de scoring 98 por item

| Item auditado | Nota atual | Nota alvo | Criterio objetivo para 98+ | Evidencia atual | Backlog vinculado |
|---|---:|---:|---|---|---|
| Aderencia ao escopo do MVP | 96 | 98 | Checklist anti-expansao aplicado a todos os modulos adjacentes. | Escopo classificado, mas checklist ainda nao formalizado. | `B98-20`, `B98-22` |
| Direcao de produto | 96 | 98 | Backlog e PRs usando matriz operacional vs CRM/BI/HIS. | Direcao correta, sem gate formal. | `B98-20`, `B98-22` |
| Chat e inbox operacional | 95 | 98 | Controllers, use cases e contratos com coverage >= 80%. | `@cvg/chat` em 41.40%; desk-web Inbox coberto parcialmente. | `B98-05`, `B98-07` |
| Tarefas operacionais | 98 | 98 | Coverage mantido >= 90% e gate permanente. | `@cvg/tasks` em 96.69%. | `B98-07` |
| Notas internas | 88 | 98 | CRUD, permissoes, erros e UI operacional cobertos. | Pagina `Notes.tsx` aparece com 0% no coverage do frontend. | `B98-03`, `B98-07` |
| Alertas e notificacoes | 92 | 98 | Listagem, filtros, ack/read, erros e eventos cobertos. | Pagina `Alerts.tsx` aparece com 0% no coverage do frontend. | `B98-03`, `B98-06`, `B98-07` |
| Admin e RBAC | 92 | 98 | Sessao HttpOnly, CSRF, permissoes por setor e testes de regressao. | `@cvg/auth` em 71.21%; token ainda vem do storage. | `B98-08`, `B98-09`, `B98-03` |
| Dashboard e KPIs | 90 | 98 | KPIs operacionais, vazios, erros e limite anti-BI cobertos. | Pagina `Dashboard.tsx` aparece com 0% no coverage do frontend. | `B98-03`, `B98-20` |
| Auditoria e observabilidade | 92 | 98 | Runbook de evidencia/readiness e QA production-profile arquivado. | Gates locais verdes; sem nova rodada production-profile. | `B98-14`, `B98-15`, `B98-21` |
| Gateway e integracao de mensagens | 92 | 98 | Contratos, retry, idempotencia e falhas cobertos. | Eventos em 48.56%; chat em 41.40%. | `B98-05`, `B98-06`, `B98-16` |
| Realtime | 94 | 98 | Fluxo principal sem token persistido e revalidacao coberta. | Testes passam; legado com token em URL ainda existe para compatibilidade. | `B98-10`, `B98-12` |
| Arquitetura modular | 92 | 98 | Todos os pacotes runtime com typecheck real e sem validacao parcial. | 20/27 pacotes sem script `typecheck`. | `B98-11`, `B98-12`, `B98-13` |
| Build | 100 | 100 | `pnpm run build` obrigatorio e verde. | PASS 27/27. | Manutencao |
| Lint e warnings de manutencao | 100 | 100 | `pnpm run lint` obrigatorio e sem warnings novos. | PASS 27/27. | Manutencao |
| Typecheck | 92 | 98 | Workspace completo coberto por `tsc --noEmit` ou equivalente tipado. | PASS em 7 pacotes; escopo parcial. | `B98-11`, `B98-12`, `B98-13` |
| Testes automatizados | 97 | 98 | Suite verde, smoke/E2E critico e coverage com threshold bloqueante. | `pnpm run test` PASS; coverage abaixo do minimo. | `B98-03` a `B98-07` |
| Coverage critico | 82 | 98 | Todos os pacotes criticos >= 80% e comando falhando em regressao. | 5/6 pacotes criticos abaixo de 80%. | `B98-03` a `B98-07` |
| Seguranca de dependencias | 91 | 98 | Audit verde, sessao segura, CSRF e politica de dependencias transitivas. | Audit PASS; token ainda em storage. | `B98-08`, `B98-09`, `B98-17`, `B98-18`, `B98-19` |
| Performance e QA full-cycle | 94 | 98 | `QA_PERF_PROFILE=production` com `scenario_passed=true` e p95 dentro do SLO. | Ultima evidencia e local Docker; production-profile ainda pendente. | `B98-14`, `B98-15`, `B98-16` |
| Tooling frontend/Vite | 100 | 100 | Build limpo, politica de upgrade e compatibilidade documentada. | Vite 7.3.2 builda sem warning. | Manutencao, `B98-19` |
| Documentacao | 94 | 98 | Score, backlog, QA log e auditoria final sincronizados com gates. | Este baseline fecha B98-01/B98-02; auditoria final ainda pendente. | `B98-21`, `B98-22` |
| Prontidao para producao | 91 | 98 | Sessao segura, coverage, typecheck completo e QA production-profile fechados. | Lacunas confirmadas neste baseline. | `B98-08` a `B98-16` |

## 5. Typecheck e validacoes parciais

Pacotes com `typecheck` real no baseline:

- `@cvg/desk-web`
- `@cvg/message-worker`
- `@cvg/realtime-service`
- `@cvg/dashboard`
- `@cvg/database`
- `@cvg/events`
- `@cvg/realtime`

Pacotes sem script `typecheck` real no baseline:

- `@cvg/desk-api`
- `@cvg/admin`
- `@cvg/alerts`
- `@cvg/audit`
- `@cvg/auth-module`
- `@cvg/chat`
- `@cvg/chatwoot-compat`
- `@cvg/contact-groups`
- `@cvg/contacts`
- `@cvg/gateway-adapter`
- `@cvg/kanban`
- `@cvg/labels`
- `@cvg/notes`
- `@cvg/secretary-adapter`
- `@cvg/sectors`
- `@cvg/tasks`
- `@cvg/transfers`
- `@cvg/auth`
- `@cvg/integrations`
- `@cvg/shared`

Leitura: o baseline de typecheck e verde, mas parcial. A frente `B98-11` a `B98-13` continua bloqueando nota 98 para Typecheck, Arquitetura modular e Prontidao para producao.

## 6. Sessao web e storage

Busca executada:

```bash
rg "localStorage|sessionStorage" apps modules packages -n
```

Resultado relevante:

- `apps/desk-web/src/lib/api.ts:23` consulta `localStorage.getItem('auth-storage')`.
- `apps/desk-web/src/__tests__/api-client.test.ts` possui teste que confirma o comportamento atual.

Leitura: o risco de sessao web persistida no storage continua confirmado. Isso bloqueia nota 98 em Seguranca, Admin/RBAC, Realtime e Prontidao para producao ate a execucao de `B98-08`, `B98-09` e `B98-10`.

## 7. Lacunas P0/P1 confirmadas pelo baseline

| Lacuna | Prioridade | Backlog |
|---|---|---|
| Coverage critico abaixo de 80% em `desk-api`, `chat`, `auth`, `events` e `desk-web`. | P0 | `B98-03` a `B98-07` |
| Comando `test:coverage:critical` nao bloqueia thresholds reais. | P0 | `B98-07` |
| Sessao web ainda depende de token no `localStorage`. | P0 | `B98-08` |
| CSRF ainda precisa ser implementado para mutacoes autenticadas por cookie. | P0 | `B98-09` |
| Realtime ainda mantem fluxo legado com token em URL. | P0 | `B98-10` |
| Typecheck real cobre 7/27 pacotes, nao workspace completo. | P0 | `B98-11` a `B98-13` |
| QA production-profile ainda nao foi executado neste ciclo. | P0 | `B98-14` a `B98-16` |
| Politica de dependencia transitiva ainda precisa existir para sustentacao. | P1 | `B98-17` a `B98-19` |

## 8. Decisao de fechamento do P0 baseline

`B98-01` e `B98-02` estao concluidos porque:

- todos os itens analisados no relatorio 81 foram copiados para matriz de score 98;
- cada item abaixo de 98 tem criterio objetivo e backlog vinculado;
- itens ja em 98+ foram marcados como manutencao;
- os gates de baseline definidos no backlog foram executados;
- lacunas encontradas foram registradas sem elevar nota por estimativa.

Proximo passo recomendado: iniciar `B98-03` a `B98-07`, porque coverage e o maior bloqueador numerico para elevar todos os itens para 98/100.
