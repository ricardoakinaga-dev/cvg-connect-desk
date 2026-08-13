# Backlog Pos-Bloqueios para 98/100

**Data:** 2026-04-28  
**Status:** backlog executado em P0/P1/P2  
**Plano executivo:** `docs/86-plano-executivo-pos-bloqueios-98.md`  
**Roadmap:** `docs/87-roadmap-pos-bloqueios-98.md`

## Convencoes

| Prioridade | Significado |
|---|---|
| P0 | Bloqueia declaracao de 98/100 ou readiness de producao |
| P1 | Sustenta qualidade, governanca e anti-regressao |
| P2 | Melhoria operacional ou automacao complementar |

## Concluidos neste ciclo

### PB98-01 - Remover token web de `localStorage` e Bearer

**Status:** concluido  
**Prioridade:** P0  
**Area:** security/frontend/auth  
**Evidencia:** `apps/desk-web/src/lib/api.ts`, `apps/desk-web/src/store/auth.ts`, `pnpm --filter @cvg/desk-web test`.

Resultado:

- API client usa `credentials: "include"`.
- Mutacoes enviam `X-CSRF-Token` quando cookie CSRF existe.
- Store de auth nao persiste token.
- Logout limpa estado local sem depender de token.

### PB98-02 - Migrar realtime para auth por cookie e rejeitar token legado

**Status:** concluido  
**Prioridade:** P0  
**Area:** realtime/security  
**Evidencia:** `apps/realtime-service/src/index.ts`, `pnpm --filter @cvg/realtime-service test`.

Resultado:

- Handshake usa cookie `cvg_session`.
- Revalidacao usa header `Cookie`.
- Mensagem `auth` com token recebe erro.
- URL `?token=` e rejeitada com close code 4003.

### PB98-03 - Fazer `test:coverage:critical` falhar abaixo de 80%

**Status:** concluido  
**Prioridade:** P0  
**Area:** QA/coverage  
**Evidencia:** `scripts/run-critical-coverage.mjs`, `pnpm run test:coverage:critical`.

Resultado:

- O comando executa coverage por pacote critico.
- Le `coverage-summary.json`.
- Falha quando statements < 80%.
- Estado atual falha corretamente por cobertura insuficiente.

### PB98-04 - Expandir `typecheck` para workspace completo

**Status:** concluido  
**Prioridade:** P0  
**Area:** TypeScript/devex  
**Evidencia:** `pnpm run typecheck` com 27/27 pacotes.

Resultado:

- Root `typecheck` usa `turbo run typecheck`.
- Pacotes sem `tsconfig` usam `scripts/typecheck-package.mjs`.
- Erros reais encontrados foram corrigidos.
- `desk-api` roda typecheck runtime sem fixtures de `src/__tests__`.

### PB98-05 - Corrigir perfil de QA para p95 production por padrao

**Status:** concluido como configuracao  
**Prioridade:** P0  
**Area:** QA/performance  
**Evidencia:** `scripts/run-full-cycle-archive.sh`, `stress-test/k6-stress-test.js`, `stress-test/run-k6-stress.sh`.

Resultado:

- Perfil default e `production`.
- Threshold default e 500ms.
- `local-docker` precisa ser escolhido explicitamente para 1500ms.

## P0 - Coverage critico

### PB98-06 - Elevar `@cvg/auth` de 75.40% para >= 80%

**Status:** concluido  
**Area:** auth/testes  
**Impacto:** remove o menor bloqueio de coverage.

Tarefas:

- Cobrir `sector-permissions.ts`.
- Testar admin global com e sem role `Admin`.
- Testar falhas de consulta de roles.
- Cobrir branches restantes de login/logout/me.

Aceite:

- `@cvg/auth` fechou em 89.05% statements.
- `pnpm run test:coverage:critical` passa em `@cvg/auth`.

### PB98-07 - Elevar `@cvg/events` de 48.56% para >= 80%

**Status:** concluido  
**Area:** events/testes  
**Impacto:** reduz risco em outbox, realtime e integracao de mensagens.

Tarefas:

- Cobrir `alert-events.ts`.
- Cobrir `chat-events.ts`.
- Cobrir `handoff-events.ts`.
- Cobrir `consumer.ts`.
- Cobrir `retry.ts`.
- Completar branches de `outbox-reader.ts`.

Aceite:

- Statements 96.16%.
- Testes validam estrutura dos envelopes e comportamento de retry/failure.

### PB98-08 - Elevar `@cvg/chat` de 41.46% para >= 80%

**Status:** concluido  
**Area:** chat/testes  
**Impacto:** aumenta nota de chat/inbox e gateway.

Tarefas:

- Cobrir `outbound.controller.ts`.
- Cobrir `webhook-inbound.controller.ts`.
- Cobrir repositorios de conversa e mensagem em branches ainda descobertos.
- Testar erros de validacao, not found, media e falha de gateway.

Aceite:

- Statements 89.60%.
- `pnpm --filter @cvg/chat test` passa.
- Fluxo Secretary/handoff continua preservando motivo real.

### PB98-09 - Elevar `@cvg/desk-web` de 36.50% para >= 80%

**Status:** concluido  
**Area:** frontend/testes  
**Impacto:** remove maior lacuna visivel de UI operacional.

Tarefas:

- Cobrir Alerts.
- Cobrir Audit.
- Cobrir ContactGroups.
- Cobrir Contacts.
- Cobrir Dashboard.
- Cobrir Labels.
- Cobrir Notes.
- Cobrir Sectors.
- Cobrir Settings.
- Cobrir Tasks.
- Cobrir branches restantes de `api.ts` e `realtime.ts`.

Aceite:

- Statements 81.17%.
- Testes cobrem loading, vazio, erro e sucesso.
- Nenhum teste depende de token em storage.

### PB98-10 - Elevar `@cvg/desk-api` de 49.74% para >= 80%

**Status:** concluido  
**Area:** API/testes  
**Impacto:** readiness e observabilidade.

Tarefas:

- Cobrir `logger.ts`.
- Cobrir `tracing.ts`.
- Cobrir `alerting.ts`.
- Cobrir `metrics.ts`.
- Cobrir branches de erro, readiness e CSRF em `app.ts`.

Aceite:

- Statements 86.25%.
- Tests runtime nao dependem de fixtures de integracao com tipos divergentes.

### PB98-11 - Fazer `pnpm run test:coverage:critical` passar

**Status:** concluido  
**Area:** QA/coverage  
**Dependencias:** PB98-06 a PB98-10.

Aceite:

- Todos os pacotes criticos >= 80%.
- Comando retorna exit 0.
- Resultado registrado na auditoria final.

## P0 - Performance production-profile

### PB98-12 - Executar QA full-cycle com perfil production

**Status:** concluido  
**Area:** QA/performance  
**Comando alvo:**

```bash
QA_PERF_PROFILE=production TEARDOWN=1 pnpm run qa:full-cycle:archive
```

Aceite:

- `scenario_passed=true`.
- p95 23.64ms <= 500ms.
- checks 100%.
- 5xx 0%.
- Evidencia arquivada em `qa-runs/20260428-191356/`.
- `docs/qa-full-cycle-log.md` atualizado.

### PB98-13 - Otimizar endpoints se p95 > 500ms

**Status:** concluido  
**Area:** backend/database/performance  
**Dependencia:** PB98-12.

Tarefas:

- Identificar endpoints lentos.
- Revisar queries sem indice.
- Reduzir chamadas sequenciais em rotas criticas.
- Validar impacto com nova rodada de k6.

Aceite:

- Nova rodada production-profile passa.
- Alteracoes possuem testes ou evidencia de nao regressao.

## P1 - CI e anti-regressao

### PB98-14 - Adicionar checks anti-token ao CI

**Status:** concluido  
**Area:** security/CI  

Tarefas:

- Criar script ou job que falhe se web/realtime produtivo usar `localStorage` para token.
- Falhar se `Authorization: Bearer` reaparecer no fluxo web/realtime.
- Permitir ocorrencias em testes de rejeicao/asserts negativos.

Aceite:

- Check documentado em `scripts/check-no-session-token-regression.mjs`.
- Script `pnpm run check:security:session` passa no estado atual.
- Workflow `Quality Gates` executa a guarda no CI.

### PB98-15 - Garantir CI com gates completos

**Status:** concluido  
**Area:** CI/devex  

Tarefas:

- Executar `lint`, `build`, `typecheck`, `test`, `test:coverage:critical` e `audit`.
- Publicar artifacts de coverage.
- Publicar logs de QA quando aplicavel.

Aceite:

- Pipeline `Quality Gates` executa `pnpm run ci:gates`.
- `scripts/run-critical-coverage.mjs` mostra claramente qual pacote falhou.
- Coverage artifacts dos pacotes criticos sao publicados.

### PB98-16 - Documentar politica de dependencias transitivas

**Status:** concluido  
**Area:** supply chain  

Tarefas:

- Registrar warnings conhecidos de `pnpm install`.
- Definir owner e data de revisao.
- Usar overrides apenas com justificativa e testes.

Aceite:

- `pnpm audit --audit-level moderate` PASS: nenhuma vulnerabilidade conhecida.
- Politica criada em `docs/89-politica-dependencias-transitivas.md`.

## P1 - Documentacao e auditoria

### PB98-17 - Atualizar mapa documental

**Status:** concluido neste ciclo  
**Area:** documentacao  
**Evidencia:** `docs/00-meta/README.md`.

Aceite:

- Documentos 86-88 aparecem como fonte atual pos-bloqueios.
- Documentos 82-85 permanecem historicos/baseline anterior.

### PB98-18 - Emitir auditoria final 98

**Status:** concluido  
**Area:** auditoria/documentacao  
**Dependencias:** PB98-11 e PB98-12.

Tarefas:

- Reexecutar todos os gates.
- Recalcular nota por item.
- Referenciar evidencias.
- Registrar riscos residuais.

Aceite:

- Novo documento em `docs/90-relatorio-auditoria-final-98.md`.
- Todos os itens com nota justificada.
- Nenhum item marcado 98 sem gate aprovado.

## Ordem recomendada

1. PB98-06 a PB98-10: concluidos.
2. PB98-11: concluido.
3. PB98-12/PB98-13: concluidos.
4. PB98-14/PB98-15/PB98-16: concluidos.
5. PB98-18: concluido.
