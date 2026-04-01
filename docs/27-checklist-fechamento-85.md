# Checklist de Fechamento — 78 para 85+

**Data:** 01/04/2026  
**Objetivo:** executar as correções finais necessárias para elevar o projeto de **78/100** para **85/100 ou mais**  
**Base:** `docs/24-relatorio-docs-vs-codigo.md`, `docs/25-plano-85-premium.md`, `docs/RELATORIO_FINAL_EXECUCAO.md`

## Meta Final

- `pnpm test` passando com testes reais nos módulos críticos
- `pnpm lint` passando sem depender de `echo lint` nos pacotes centrais
- `pnpm typecheck` passando na raiz
- `EventBus` real conectado entre API, worker e realtime
- documentação final consistente com o estado do código

## Etapa 1 — Fechar `typecheck`

- [ ] Corrigir erros de tipos em `modules/admin/src/application/use-cases/index.ts`
- [ ] Corrigir imports e tipos inexistentes em `modules/admin/src/infrastructure/repositories/admin.repository.ts`
- [ ] Corrigir imports com extensão `.ts` e tipos de request em `modules/admin/src/presentation/http/admin.controller.ts`
- [ ] Corrigir exports/tipos em `modules/admin/src/types/index.ts`
- [ ] Rodar `pnpm --filter @cvg/admin typecheck`
- [ ] Rodar `pnpm typecheck`

**Critério de saída:** `pnpm typecheck` com exit code `0`

## Etapa 2 — Ativar o EventBus real

- [ ] Exportar `bus.ts` em `packages/events/src/index.ts`
- [ ] Substituir uso do publisher antigo em `modules/chat/src/application/events/chat-publisher.ts`
- [ ] Substituir uso do publisher antigo em `modules/secretary-adapter/src/application/use-cases/secretary-publisher.ts`
- [ ] Conectar realtime ao `EventBus` real em `apps/realtime-service/src/index.ts`
- [ ] Conectar worker ao `EventBus` real em `apps/message-worker/src/index.ts`
- [ ] Garantir fallback explícito para memória apenas em dev/test
- [ ] Validar publicação e consumo de `conversation.status.changed` e `conversation.assigned`

**Critério de saída:** evento publicado pela API chega ao worker e ao realtime em processo separado

## Etapa 3 — Remover `echo` dos pacotes críticos

- [ ] Remover `echo build/lint/test` de `apps/desk-api/package.json`
- [ ] Remover `echo build/lint/test` de `apps/message-worker/package.json`
- [ ] Remover `echo build/lint/test` de `apps/realtime-service/package.json`
- [ ] Remover `echo build/lint/test` de `modules/admin/package.json`
- [ ] Remover `echo build/lint/test` de `modules/dashboard/package.json`
- [ ] Remover `echo build/lint/test` de `modules/audit/package.json`
- [ ] Ajustar `turbo.json` se necessário para `outputs`

**Critério de saída:** pacotes centrais usam comandos reais de validação

## Etapa 4 — Adicionar testes reais

- [ ] Criar testes para dashboard premium em `modules/dashboard/src/__tests__`
- [ ] Criar testes para audit premium em `modules/audit/src/__tests__`
- [ ] Criar testes para admin em `modules/admin/src/__tests__`
- [ ] Criar ao menos 1 teste do fluxo realtime/projeções em `packages/realtime/src`
- [ ] Cobrir endpoints `/metrics/premium`, `/metrics/handoff`, `/audit/conversation/:id`, `/audit/correlation/:id`
- [ ] Rodar `pnpm test`

**Critério de saída:** cobertura aumenta nos módulos premium e admin sem `passWithNoTests` onde houver lógica crítica

## Etapa 5 — Reconciliar documentação e nota

- [ ] Atualizar `docs/24-relatorio-docs-vs-codigo.md` com a nota real final
- [ ] Atualizar `docs/25-plano-85-premium.md` com status real por etapa
- [ ] Atualizar `docs/RELATORIO_FINAL_EXECUCAO.md` removendo inconsistências de nota
- [ ] Atualizar `docs/18-deployment-and-runtime.md` para refletir o `EventBus` real
- [ ] Atualizar `docs/14-roadmap.md` com o estado final

**Critério de saída:** todos os docs principais apontam para a mesma leitura de status e nota

## Validação Final Obrigatória

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`

## Meta de Aceite para Chamar de 85+

- [ ] Zero falhas em `test`, `lint` e `typecheck`
- [ ] `EventBus` real ativo nos runtimes principais
- [ ] Testes reais cobrindo dashboard, audit, admin e realtime
- [ ] Documentação final coerente
- [ ] Nota reavaliada mínima: **85/100**

## Observação Operacional

Este checklist só pode ser marcado como concluído quando a validação final for executada de ponta a ponta e os documentos finais refletirem exatamente o estado real do código.
