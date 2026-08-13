# Roadmap de Melhorias Necessarias

**Data:** 2026-04-27  
**Documento base:** `docs/76-relatorio-auditoria-escopo-estado-atual.md`  
**Plano executivo:** `docs/77-plano-executivo-melhorias-necessarias.md`

> Atualizacao de fechamento: roadmap executado em 2026-04-27. Evidencia e notas por item: `docs/80-fechamento-execucao-p0-p1-p2.md`.

## Objetivo

Executar um ciclo de reconciliacao e hardening para levar o projeto de **76/100** para **96/100 verificavel**, sem expansao funcional fora do MVP.

## Marco 0: Congelamento de escopo

**Objetivo:** impedir que novas features aumentem a superficie antes dos gates ficarem verdes.

Entregas:

- Declarar freeze temporario de feature.
- Classificar modulos extras como `MVP`, `adjacente permitido` ou `futuro`.
- Alinhar time em torno de hardening.

Critério de aceite:

- Nenhum modulo novo criado antes dos gates centrais passarem.
- Documento de matriz de escopo criado ou secao adicionada em doc existente.

## Sprint 1: Desbloqueio arquitetural e gates base

**Prioridade:** P0  
**Objetivo:** recuperar `build`, `lint` e `typecheck`.

### R1.1 Quebrar ciclo chat/gateway

Problema:

- `@cvg/chat` depende de `@cvg/gateway-adapter`.
- `@cvg/gateway-adapter` depende de `@cvg/chat`.

Direcao tecnica:

- Extrair tipos/contratos neutros para `@cvg/shared` ou novo pacote de contratos.
- Fazer `chat` depender de uma interface de envio, nao do adapter concreto.
- Fazer `gateway-adapter` implementar a interface sem importar `chat`.

Critério de aceite:

- Turbo nao reporta ciclo entre os pacotes.
- `pnpm run build` deixa de falhar por ciclo.
- `pnpm run lint` deixa de falhar por ciclo.

### R1.2 Tornar typecheck executavel

Problema:

- `pnpm run typecheck` chama `turbo run typecheck`, mas a task nao existe em todos os projetos.

Critério de aceite:

- Todos os pacotes relevantes possuem script `typecheck`.
- `turbo.json` declara task `typecheck`.
- `pnpm run typecheck` passa.

### R1.3 Substituir scripts placeholder criticos

Problema:

- Diversos pacotes usam `build: echo build` e `lint: echo lint`.

Critério de aceite:

- Pacotes runtime usam `tsc --noEmit` ou build real.
- Scripts placeholder remanescentes sao documentados como intencionais ou removidos.

## Sprint 2: Estabilizacao de testes

**Prioridade:** P0  
**Objetivo:** fazer `pnpm test` passar na raiz.

### R2.1 Corrigir fixtures da API

Problemas conhecidos:

- Role `Admin` duplicada em teste de dashboard.
- Login em rate-limit retorna `401`.
- Cleanup com UUID vazio em webhook security stats.
- Teste de contacts espera telefone divergente.

Critério de aceite:

- `pnpm --filter @cvg/desk-api test` passa.
- `pnpm test` passa.
- Nenhum teste novo fica skipped sem justificativa.

### R2.2 Isolar banco de testes

Objetivo:

- Reduzir falhas por estado residual.

Critério de aceite:

- Fixtures usam identificadores unicos.
- Cleanup e idempotente.
- Roles globais sao reutilizadas com `on conflict` ou nomes unicos.

### R2.3 Revalidar suites criticas

Comandos obrigatorios:

- `pnpm --filter @cvg/tasks test`
- `pnpm --filter @cvg/desk-web test`
- `pnpm --filter @cvg/desk-api test`
- `pnpm test`

## Sprint 3: Seguranca e supply chain

**Prioridade:** P0/P1  
**Objetivo:** remover vulnerabilidades high e reduzir moderates.

### R3.1 Atualizar dependencias vulneraveis

Pacotes prioritarios:

- `fastify`.
- `vite`.
- `esbuild`.
- `postcss`.
- `follow-redirects`.
- `@fastify/static`.
- `uuid`.

Critério de aceite:

- `pnpm audit --audit-level moderate` sem vulnerabilidades high.
- Moderates remanescentes com justificativa e prazo.
- Testes principais continuam passando.

### R3.2 Decidir estrategia de sessao

Problema:

- Token bearer persistido no `localStorage`.

Opcoes:

- Migrar para cookie `HttpOnly`, `Secure`, `SameSite`.
- Manter temporariamente com mitigacoes e risco aceito documentado.

Critério de aceite:

- Decisao documentada.
- Se migrado, login/logout/frontend atualizados e testados.

## Sprint 4: QA full-cycle e performance

**Prioridade:** P0  
**Objetivo:** fazer `qa:full-cycle` passar sem falso positivo.

### R4.1 Corrigir health do ciclo

Problema:

- O script aceita HTTP 200 mesmo quando payload tem `status:"error"`.

Critério de aceite:

- `scripts/run-full-cycle.sh` valida `status === "ok"`.
- Se Redis/Gateway exigidos falharem, ciclo falha antes do stress.

### R4.2 Corrigir Redis health check

Problema:

- Redis e testado via `fetch(http://redis:6379/)`, que nao e protocolo Redis.

Critério de aceite:

- Health usa socket TCP, cliente Redis ou estrategia valida.
- Payload `/health` nao retorna erro falso com Redis saudavel.

### R4.3 Fechar p95 de stress

Problema:

- p95 atual: 431.08ms.
- threshold atual: 200ms.

Critério de aceite:

- `scenario_thresholds.scenario_passed=true`.
- Se threshold for alterado, decisao documentada com justificativa tecnica.

### R4.4 Gerar evidencia final

Comando:

```bash
TEARDOWN=1 pnpm run qa:full-cycle:archive
```

Critério de aceite:

- Log salvo em `qa-runs/<timestamp>/qa-full-cycle.log`.
- Summary salvo em `qa-runs/<timestamp>/summary.json`.
- `docs/qa-full-cycle-log.md` atualizado com PASS.

## Sprint 5: Reconciliacao documental

**Prioridade:** P1  
**Objetivo:** alinhar documentacao e score ao estado real.

Entregas:

- Atualizar `docs/72-roadmap-98-porcento.md`.
- Atualizar `docs/73-backlog-98-porcento.md`.
- Atualizar `docs/75-roadmap-98-porcento.md`.
- Marcar relatorios antigos como historicos quando divergirem.
- Criar secao de evidencias executadas.

Critério de aceite:

- Nenhum documento afirma 96/100 sem link para evidencia do ciclo.
- Roadmap e backlog refletem gates reais.

## Linha do tempo sugerida

| Semana | Foco | Resultado esperado |
|---|---|---|
| Semana 1 - Dia 1 | Ciclo chat/gateway + typecheck | Build/lint/typecheck desbloqueados |
| Semana 1 - Dia 2 | Testes API | `@cvg/desk-api test` passa |
| Semana 1 - Dia 3 | Test raiz + fixtures | `pnpm test` passa |
| Semana 1 - Dia 4 | Audit e dependencias | Sem high vulnerabilities |
| Semana 1 - Dia 5 | QA full-cycle/performance | `scenario_passed=true` |
| Semana 2 - Dia 1 | Docs e reranking | Score atualizado com evidencia |

## Marco final

O projeto so deve ser reclassificado como **96/100** quando todos os comandos abaixo passarem no mesmo estado de codigo:

```bash
pnpm run build
pnpm run lint
pnpm run typecheck
pnpm test
pnpm audit --audit-level moderate
TEARDOWN=1 pnpm run qa:full-cycle:archive
```
