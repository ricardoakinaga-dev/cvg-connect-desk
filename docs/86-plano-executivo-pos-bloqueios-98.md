# Plano Executivo Pos-Bloqueios para 98/100

**Data:** 2026-04-28  
**Status:** executado; bloqueios P0 fechados e P1/P2 formalizados  
**Documentos anteriores:** `docs/82-plano-executivo-98-todos-itens.md`, `docs/85-baseline-governanca-score-98.md`  
**Objetivo:** consolidar o novo plano executivo depois da remocao dos bloqueios de sessao web, realtime, coverage gate, typecheck workspace e perfil de QA.

## 1. Resumo executivo

Os principais bloqueios tecnicos foram tratados e validados. O projeto agora tem sessao web sem token persistido em `localStorage`, realtime autenticado por cookie, `typecheck` cobrindo o workspace, coverage critico com threshold real de 80%, QA full-cycle em perfil `production` aprovado e CI com guarda anti-regressao.

Resultado executivo em 2026-04-28:

- `pnpm run test:coverage:critical` PASS em 6/6 pacotes criticos;
- `QA_PERF_PROFILE=production TEARDOWN=1 pnpm run qa:full-cycle:archive` PASS com p95 23.64ms;
- `pnpm run check:security:session` PASS contra storage token/Bearer em web/realtime;
- `pnpm audit --audit-level moderate` PASS sem vulnerabilidades conhecidas;
- workflow `Quality Gates` criado para bloquear PRs sem lint/build/typecheck/test/coverage/audit.

Decisao executiva: o plano P0 foi concluido. A proxima etapa operacional e manter os gates vivos no CI e tratar apenas riscos residuais de branch/function coverage e observabilidade de producao.

## 2. Bloqueios encerrados

| Bloqueio | Status | Evidencia |
|---|---|---|
| Sessao web usava token em `localStorage` e `Authorization: Bearer` | Encerrado | `apps/desk-web/src/lib/api.ts`, `apps/desk-web/src/store/auth.ts`; testes `@cvg/desk-web` passam. |
| `test:coverage:critical` nao falhava abaixo de 80% | Encerrado | `scripts/run-critical-coverage.mjs`; comando agora falha com pacotes abaixo do minimo. |
| `typecheck` cobria apenas 7 pacotes | Encerrado | `pnpm run typecheck` executa `turbo run typecheck` em 27/27 pacotes e passa. |
| Realtime revalidava Bearer e mantinha token legado como fluxo principal | Encerrado | `apps/realtime-service/src/index.ts`; cookie de sessao no handshake/revalidacao; `?token=` legado rejeitado. |
| QA archive aceitava p95 1500ms por padrao | Encerrado como configuracao | `scripts/run-full-cycle-archive.sh` e `stress-test/k6-stress-test.js` usam `production`/500ms por padrao. |

## 3. Estado atual dos gates

| Gate | Resultado atual | Leitura executiva |
|---|---:|---|
| `pnpm run typecheck` | PASS em rodada anterior pos-bloqueios | Bloqueio de typecheck completo resolvido; gate mantido em `ci:gates`. |
| `pnpm --filter @cvg/auth test` | PASS, 27 tests | Sessao cookie/CSRF coberta no pacote auth. |
| `pnpm --filter @cvg/desk-web test` | PASS, 41 tests | Frontend sem token persistido no fluxo principal. |
| `pnpm --filter @cvg/realtime-service test` | PASS, 67 tests | Realtime por cookie e rejeicao de token legado cobertos. |
| `pnpm --filter @cvg/chat test` | PASS, 39 tests | Ajuste de handoff preservando motivo real validado. |
| `pnpm run test:coverage:critical` | PASS | Todos os pacotes criticos >= 80% statements. |
| `QA_PERF_PROFILE=production ... qa:full-cycle:archive` | PASS | Run `qa-runs/20260428-191356`: p95 23.64ms, 0% 5xx, checks 100%. |
| `pnpm run check:security:session` | PASS | Nenhum token de sessao em storage e nenhum Bearer no fluxo web/realtime produtivo. |
| `pnpm audit --audit-level moderate` | PASS | Nenhuma vulnerabilidade conhecida. |

## 4. Coverage critico atual

Rodada final de `pnpm run test:coverage:critical` em 2026-04-28:

| Pacote critico | Statements | Status |
|---|---:|---|
| `@cvg/desk-api` | 86.25% | Apto |
| `@cvg/chat` | 89.60% | Apto |
| `@cvg/auth` | 89.05% | Apto |
| `@cvg/events` | 96.16% | Apto |
| `@cvg/tasks` | 96.69% | Apto |
| `@cvg/desk-web` | 81.17% | Apto |

Interpretacao: o gate esta correto e passou sem excecoes artificiais. O ponto residual e elevar branch/function coverage onde ainda estiver abaixo do padrao desejado, principalmente frontend.

## 5. Nova priorizacao executiva

### P0: Fechar qualidade mensuravel

Objetivo concluido: `pnpm run test:coverage:critical` passa sem excecoes artificiais.

Foco:

- `@cvg/desk-web`: paginas operacionais hoje sem coverage.
- `@cvg/chat`: controllers HTTP e repositorios.
- `@cvg/events`: publishers, consumers, retry e eventos tipados.
- `@cvg/desk-api`: logger, tracing, alerting, metrics e paths de erro.
- `@cvg/auth`: `sector-permissions` e paths restantes de controller.

### P0: Provar performance de producao

Objetivo concluido: QA full-cycle com perfil `production` aprovado com p95 <= 500ms.

Foco:

- rodar em ambiente equivalente a producao;
- arquivar `summary.json`, logs e metadados;
- corrigir endpoints lentos se p95 continuar acima de 500ms;
- nao aceitar `local-docker` como substituto de readiness.

### P1: Sustentacao de governanca

Objetivo concluido como baseline de governanca: evitar regressao dos bloqueios resolvidos.

Foco:

- manter `typecheck` em 27/27 pacotes;
- manter `pnpm run check:security:session` no CI;
- documentar exceptions de dependencias transitivas;
- manter perfil production como default no QA.

## 6. Criterios para declarar 98/100

Todos os itens abaixo devem estar verdadeiros:

- `pnpm run check:security:session` passa.
- `pnpm run typecheck` passa com cobertura de workspace.
- `pnpm run test:coverage:critical` passa com todos os pacotes criticos >= 80%.
- `pnpm audit --audit-level moderate` passa ou possui excecao formal aprovada.
- `QA_PERF_PROFILE=production TEARDOWN=1 pnpm run qa:full-cycle:archive` passa.
- `summary.json` do QA mostra `scenario_passed=true`, p95 <= 500ms, checks >= 99% e 5xx dentro do limite.
- CI executa `lint`, `build`, `typecheck`, `test`, `test:coverage:critical`, `audit` e guarda anti-token.

## 7. Decisao sobre notas

Com os bloqueios resolvidos e os gates aprovados, a auditoria final pode declarar 98/100 nos itens que possuem evidencia direta. Itens com cobertura de branch/function abaixo do ideal permanecem como risco residual, sem bloquear a declaracao de readiness do plano atual.

| Area | Estado pos-bloqueios | Nota operacional sugerida | Condicao para 98 |
|---|---|---:|---|
| Typecheck | Completo no workspace e mantido em CI | 98 | Manter no CI. |
| Seguranca de sessao | Cookie HttpOnly + CSRF no fluxo web + guarda anti-token | 98 | Manter check estatico e E2E. |
| Realtime | Cookie + rejeicao de token legado | 98 | Manter testes e monitoramento. |
| Coverage critico | Gate real aprovado em 6/6 pacotes | 98 | Evitar queda abaixo de 80%. |
| Performance | QA production-profile PASS p95 23.64ms | 98 | Monitorar p95 em ambiente continuo. |
| Prontidao de producao | Coverage + QA production aprovados | 98 | Manter evidencias por release. |

## 8. Proximo ciclo recomendado

Executar em ordem de manutencao:

1. Rodar `pnpm run ci:gates` antes de PRs relevantes.
2. Manter `QA_PERF_PROFILE=production TEARDOWN=1 pnpm run qa:full-cycle:archive` como evidencia de release.
3. Elevar branch/function coverage do frontend sem reduzir o foco comportamental.
4. Revisar dependencias transitivas conforme `docs/89-politica-dependencias-transitivas.md`.
5. Atualizar auditoria final quando qualquer gate mudar.

## 9. Resultado esperado

Este plano foi concluido no escopo P0/P1/P2 definido: bloqueios tecnicos fechados, coverage critico aprovado, evidencia de performance production-profile arquivada, CI anti-regressao formalizado e documentacao pronta para auditoria final com score geral minimo de 98/100.
