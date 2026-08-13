# Plano Executivo: Elevar Todos os Itens para 98/100

**Data:** 2026-04-28  
**Fonte de verdade:** `docs/81-relatorio-auditoria-pos-hardening-warnings-vite.md`  
**Objetivo:** resolver todos os riscos remanescentes e elevar cada item auditado para **98/100 ou mais**, sem expandir o produto para fora do Desk operacional.

> Atualizacao P0: baseline e governanca do score executados em 2026-04-28. Evidencia consolidada em `docs/85-baseline-governanca-score-98.md`.

## 1. Decisao executiva

O projeto nao precisa de novas frentes funcionais amplas. Precisa de um ciclo final de endurecimento tecnico, seguranca de sessao, cobertura, validacao de performance em ambiente equivalente a producao e governanca documental.

Diretriz:

- congelar expansao funcional ate todos os itens ficarem em 98+;
- priorizar riscos que impedem prontidao real de producao;
- transformar coverage, typecheck e performance em gates de qualidade permanentes;
- migrar sessao web para cookie seguro;
- tratar ou registrar dependencias transitivas com decisao tecnica verificavel;
- emitir nova auditoria apenas depois dos gates executados.

## 2. Definicao de 98/100

Um item so pode receber nota **98/100 ou maior** quando atender a todos os criterios abaixo:

| Criterio | Exigencia |
|---|---|
| Evidencia executada | Gate local/CI executado e registrado. |
| Risco residual | Nenhum risco aberto sem plano, responsavel e prazo. |
| Regressao | `build`, `lint`, `typecheck`, `test` e `audit` permanecem verdes. |
| Cobertura | Pacotes criticos com statements >= 80% e fluxos principais cobertos. |
| Seguranca | Sem token web persistido em `localStorage`/`sessionStorage`; cookie seguro implementado. |
| Performance | QA em ambiente equivalente a producao com perfil `production` e p95 <= 500ms, ou SLO formal aprovado com evidencia. |
| Escopo | Nenhuma entrega amplia o produto para CRM completo, BI avancado, HIS, funil comercial ou automacao de marketing. |

## 3. Estado atual e delta para 98

| Item analisado no relatorio 81 | Nota atual | Nota alvo | Acao executiva para chegar a 98+ |
|---|---:|---:|---|
| Aderencia ao escopo do MVP | 96 | 98 | Criar checklist de governanca de escopo e criterio de aceite para modulos adjacentes. |
| Direcao de produto | 96 | 98 | Registrar matriz de decisao: operacional vs CRM/BI/HIS; aplicar em backlog e PRs. |
| Chat e inbox operacional | 95 | 98 | Ampliar testes de controllers, contratos e fluxos de inbox. |
| Tarefas operacionais | 98 | 98 | Manter coverage e incluir regressao no gate critico permanente. |
| Notas internas | 88 | 98 | Cobrir CRUD, permissao, vinculo com conversa e UI operacional. |
| Alertas e notificacoes | 92 | 98 | Cobrir leitura/ack, filtros, regras e resiliencia de eventos. |
| Admin e RBAC | 92 | 98 | Migrar sessao web para cookie seguro e ampliar testes de permissoes por setor. |
| Dashboard e KPIs | 90 | 98 | Cobrir KPIs operacionais, estados vazios/erro e limitar escopo a metricas de atendimento. |
| Auditoria e observabilidade | 92 | 98 | Criar runbook de evidencias, correlacao de logs e criterios de readiness por ambiente. |
| Gateway e integracao de mensagens | 92 | 98 | Ampliar testes de contrato, retry, idempotencia e falhas de adapter. |
| Realtime | 94 | 98 | Remover dependencia de token em URL/localStorage com ticket efemero ou cookie seguro. |
| Arquitetura modular | 92 | 98 | Substituir validacoes parciais por typecheck real em todos os pacotes. |
| Build | 100 | 100 | Manter gate obrigatorio. |
| Lint e warnings de manutencao | 100 | 100 | Manter gate obrigatorio sem warnings novos. |
| Typecheck | 92 | 98 | Cobrir todo workspace com `tsc --noEmit` ou build tipado equivalente, sem placeholder. |
| Testes automatizados | 97 | 98 | Adicionar suites de risco alto e estabilizar smoke/E2E dos fluxos centrais. |
| Coverage critico | 82 | 98 | Elevar `desk-web`, `desk-api`, `chat` e `events` para >= 80% statements. |
| Seguranca de dependencias | 91 | 98 | Tratar storage de token, CSRF, cookies e warnings/deprecacoes transitivas com decisao rastreavel. |
| Performance e QA full-cycle | 94 | 98 | Rodar QA em ambiente equivalente a producao com perfil `production`. |
| Tooling frontend/Vite | 100 | 100 | Manter Vite limpo e registrar politica de upgrade. |
| Documentacao | 94 | 98 | Atualizar docs de score, roadmap, backlog, QA log e nova auditoria final. |
| Prontidao para producao | 91 | 98 | Fechar seguranca de sessao, SLO, coverage e typecheck completo. |

## 4. Frentes de trabalho

### Frente A: Coverage e testes dos fluxos criticos

Objetivo: transformar cobertura de pacote e cobertura funcional em gate real.

Entregas:

- `@cvg/desk-web` com cobertura minima de Login, Inbox, Kanban, Notes, Alerts, Admin e Dashboard.
- `@cvg/desk-api` com testes de rotas, erros, auth, rate limit, webhook e contratos.
- `@cvg/chat` com controllers HTTP, use cases e contratos de gateway cobertos.
- `@cvg/events` com eventos tipados, outbox, dead-letter e idempotencia cobertos.
- `pnpm run test:coverage:critical` falhando quando qualquer pacote critico ficar abaixo do minimo aprovado.

Nota alvo impactada: Coverage critico 82 -> 98, Testes 97 -> 98, Chat 95 -> 98, Notes 88 -> 98, Alerts 92 -> 98, Dashboard 90 -> 98.

### Frente B: Sessao segura e realtime sem token persistido

Objetivo: remover o risco aceito de token web em storage local.

Entregas:

- Login da API emitindo cookie `HttpOnly`, `Secure` em producao e `SameSite=Lax` ou `SameSite=Strict` conforme fluxo.
- Logout invalidando sessao no servidor e expirando cookie.
- API client usando `credentials: "include"` quando necessario.
- Protecao CSRF para requests mutaveis quando autenticacao por cookie estiver ativa.
- Realtime autenticado por cookie no handshake ou por ticket efemero de curta duracao, sem token em URL persistente.
- Testes de login, logout, refresh/revalidacao, CSRF, realtime e expiracao.

Nota alvo impactada: Seguranca 91 -> 98, Admin/RBAC 92 -> 98, Realtime 94 -> 98, Prontidao producao 91 -> 98.

### Frente C: Typecheck completo e remocao de validacoes parciais

Objetivo: eliminar o risco de pacotes fora do typecheck real.

Entregas:

- Todos os apps, packages e modules com `typecheck` real.
- Remocao progressiva de `scripts/verify-package-source.mjs` onde houver `tsconfig` viavel.
- `turbo run typecheck` cobrindo workspace completo ou lista formal de excecoes temporarias.
- CI bloqueando PR que quebre tipo em qualquer pacote runtime.

Nota alvo impactada: Typecheck 92 -> 98, Arquitetura modular 92 -> 98, Prontidao producao 91 -> 98.

### Frente D: Performance, SLO e QA em ambiente equivalente a producao

Objetivo: substituir evidencia local Docker por evidencia de performance operacional.

Entregas:

- Ambiente staging/prod-like com banco, Redis, workers e limites semelhantes ao deploy real.
- `qa:full-cycle:archive` executado com `QA_PERF_PROFILE=production`.
- p95 <= 500ms ou SLO formal aprovado com justificativa tecnica.
- Relatorio de endpoints mais lentos e correcoes aplicadas.
- Runbook de execucao e interpretacao do stress test.

Nota alvo impactada: Performance 94 -> 98, Auditoria/observabilidade 92 -> 98, Prontidao producao 91 -> 98.

### Frente E: Dependencias transitivas e politica de upgrade

Objetivo: evitar que deprecacoes e warnings de instalacao se tornem divida invisivel.

Entregas:

- Inventario de warnings de `pnpm install`.
- Upgrade/substituicao quando houver versao compativel.
- `pnpm.overrides` apenas quando for seguro e testado.
- Excecao documentada para dependencia transitiva sem alternativa, com owner, prazo e gatilho de revisao.
- Politica de upgrade para Vite, Vitest/jsdom, drizzle-kit e cadeia de build.

Nota alvo impactada: Seguranca de dependencias 91 -> 98, Tooling 100 mantido, Documentacao 94 -> 98.

### Frente F: Governanca de escopo e documentacao final

Objetivo: evitar que a nota suba com ambiguidade de escopo ou evidencia incompleta.

Entregas:

- Checklist de escopo aplicado aos itens adjacentes.
- Roadmap e backlog sincronizados com estado final.
- `docs/qa-full-cycle-log.md` atualizado com nova rodada PASS.
- Nova auditoria final declarando todos os itens >= 98 somente depois dos gates.

Nota alvo impactada: Escopo 96 -> 98, Direcao produto 96 -> 98, Documentacao 94 -> 98.

## 5. Gates obrigatorios de saida

Para declarar o projeto em 98/100 em todos os itens, executar e registrar:

```bash
pnpm run lint
pnpm run build
pnpm run typecheck
pnpm run test
pnpm run test:coverage:critical
pnpm --filter @cvg/desk-web build
pnpm --filter @cvg/desk-web test
pnpm audit --audit-level moderate
QA_PERF_PROFILE=production TEARDOWN=1 pnpm run qa:full-cycle:archive
```

Saida esperada:

- todos os comandos PASS;
- nenhuma vulnerabilidade moderada ou superior sem excecao formal;
- nenhum warning de manutencao novo no lint/build/test;
- `summary.json` do QA com `scenario_passed=true`;
- p95 dentro do SLO de producao aprovado;
- coverage critico acima do minimo em todos os pacotes;
- nova auditoria final salva em `docs/`.

## 6. Sequencia recomendada

1. Baseline e scoring: confirmar cobertura atual, typecheck parcial e dependencia de token.
2. Coverage primeiro: reduzir risco de regressao antes de migrar auth.
3. Migracao HttpOnly/CSRF: resolver o maior risco de seguranca ainda aceito.
4. Typecheck workspace completo: consolidar gate permanente.
5. Performance production-profile: provar readiness operacional.
6. Dependencias transitivas e documentacao: fechar supply chain e evidencias.
7. Auditoria final 98/100: recalcular notas com base nos gates.

## 7. Resultado esperado

Ao final, o projeto deve estar em **98/100 ou mais em todos os itens analisados**, com score geral minimo de **98/100**, sem depender de risco aceito para sessao web, sem cobertura critica abaixo do minimo e sem usar QA local Docker como substituto de SLO de producao.
