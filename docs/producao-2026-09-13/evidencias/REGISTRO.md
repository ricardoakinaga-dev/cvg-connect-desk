# Registro de execução — programa de produção 13/09/2026

Atualizado: 2026-09-13 (execução PROD-36)

## Identidade do candidato

- Repositório: `/home/ricardo/cvg-connect-desk`
- HEAD: `754f9badac46278e77d21de91c58eedb15e80581` (`main`)
- Worktree: sujo — 384 entradas (205 modificadas, 179 não rastreadas) no congelamento PROD-00.
- Hash do status: ver `evidencias/prod-00/baseline/candidate-manifest.json` (`statusPorcelainSha256`).
- Delta rastreado: `diffTrackedSha256` no mesmo manifesto.
- Auditoria preservada: `docs/auditorias/2026-09-13/RELATORIO.md` (SHA-256 confere com `audit_sha256`).

## Estado por tarefa

| Tarefa | Estado | Evidência | Observação |
|---|---|---|---|
| PROD-00 | VERIFIED | `evidencias/prod-00/` | Baseline, isolamento e produção config; revisão final pendente |
| PROD-01 | IMPLEMENTED | `evidencias/prod-01/` | Contratos C01–C10 e D01–D06 mapeados; decisões permanecem OPEN |
| PROD-02 | IMPLEMENTED | `evidencias/prod-02/` | Gate de identidade/isolamento implementado; revisão final pendente |
| PROD-03 | IMPLEMENTED | `evidencias/prod-03/` | Agregador/testes implementados; GitHub Actions/branch protection externos não comprovados |
| PROD-04 | IMPLEMENTED | `evidencias/prod-04/` | Authz ação+recurso e permissões efetivas implementados; revisão pós-correções pendente |
| PROD-05 | IMPLEMENTED | `evidencias/prod-05/` | Sessão HTTP/WS; 17/17 e 14/14 |
| PROD-06 | IMPLEMENTED | `evidencias/prod-06/` | Timezone/drift/migration 0023; revisão final pendente |
| PROD-07 | IMPLEMENTED | `evidencias/prod-07/` | Anti-replay webhook; revisão pós-correções pendente |
| PROD-08 | IMPLEMENTED | `evidencias/prod-08/` | Inbound atomicidade; 19/19 |
| PROD-09 | IMPLEMENTED | `evidencias/prod-09/` | Efeitos/DLQ duráveis; regressão FK corrigida, reexecução pendente |
| PROD-10 | IMPLEMENTED | `evidencias/prod-10/` | Secretary assíncrona durável; revisão independente pendente |
| PROD-11 | IMPLEMENTED | `evidencias/prod-11/` | Reconciliação outbound/retenção; 12/12 |
| PROD-12 | IMPLEMENTED | `evidencias/prod-12/` | Leases, DLQ e fanout multi-processo; revisão independente pendente |
| PROD-13 | IMPLEMENTED | `evidencias/prod-13/` | Budget IA durável; D05 permanece OPEN |
| PROD-14 | IMPLEMENTED | `evidencias/prod-14/` | Mídia inbound + AC4 legado; MinIO permanece BLOCKED |
| PROD-15 | IMPLEMENTED | `evidencias/prod-15/` | Upload/resolução de assets; MinIO/TTL real externo permanecem limitados |
| PROD-16 | IMPLEMENTED | `evidencias/prod-16/` | Privacidade por escopo/cópia; D02 permanece OPEN |
| PROD-17 | IMPLEMENTED | `evidencias/prod-17/` | Boot/guards/capacidades; 22 arquivos, 268 testes web PASS; browser integrado pendente |
| PROD-18 | IMPLEMENTED | `evidencias/prod-18/` | APIs operacionais transacionais/auditoria; revisão independente pendente |
| PROD-36 | IMPLEMENTED | `evidencias/prod-36/` | AC1/AC2 provados em runs isolados; AC3/AC4 externos parciais por Docker/TLS/storage/rollback |

Estados permitidos: PLANNED → READY → RUNNING → IMPLEMENTED → REVIEW → VERIFIED → DONE; falha → REWORK/BLOCKED/FAILED.

## Decisões e bloqueios externos

- D01–D06: OPEN; nenhuma ratificação inventada. Recomendações técnicas em `DECISOES-EXECUCAO.md` quando registradas.
- Docker: BLOQUEADO (sem permissão no socket; sudo não interativo exige senha). Compose/CI local de serviços ausentes fica BLOCKED com dono.
- MinIO: BLOCKED por Docker/socket indisponível; PROD-14/15 usam sandbox S3 com limitação explícita. ClamAV real foi usado nas provas de mídia.
- OTel Collector: disponível em `/tmp/opencode/otelcol/otelcol-contrib`.
- PostgreSQL 16 e Redis: disponíveis via binários locais; harness AAA cria instâncias por run com marcador `cvg_aaa_*`.
- Playwright/Chromium, k6, osv-scanner: disponíveis.

## Correções de infraestrutura de teste já aplicadas (PROD-00)

- `e2e/support/aaa/pg.ts`: `LD_LIBRARY_PATH` do runtime local calculado pelo próprio harness (initdb/psql não dependem mais do shell do operador).
- `e2e/support/aaa/run-context.ts`: `CVG_PROGRAM_DIR`/`CVG_RUNTIME_DIR` configuráveis para separar evidência do programa de produção do histórico.
- `playwright.production.config.ts`: suites AAA + produção; requer `NODE_OPTIONS=--import tsx` (loader TS unificado) — sem isso o loader CJS do Playwright conflita com o type-stripping do Node 24.
- Artefatos `.js` compilados ao lado de `.ts` em `e2e/` causam descoberta duplicada de testes; tratar em PROD-34/38.

## Próxima ação

Revisar PROD-36, preservar AC3/AC4 como PARTIAL até haver ambiente Docker/TLS/storage/rollback real, e avançar PROD-19/20; manter MinIO e decisões externas como BLOCKED/OPEN.
