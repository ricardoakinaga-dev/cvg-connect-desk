# AAA-23 — Executar integração e E2E contra serviços reais

> Gerado de BACKLOG.json por plan.py; não editar manualmente.

SIMULAÇÃO: todas as tarefas permanecem PLANNED. Cada lote é apenas uma sugestão condicionada à evidência, revisão e integração dos predecessores. Não lança agentes/serviços, não executa checks e não concede aceite.

Status: PLANNED | Responsável: QA integração | Fase: 4 | Risco: R2 | Pontos: 8

## Objetivo

PostgreSQL/Redis/MinIO/ClamAV/OTel reais isolados; Gateway/Secretary sandbox distinguem contrato simulado e integração real.

## Contexto e dependências

Achados: L01
Áreas: 4, 7, 8, 11, 14
Predecessores: AAA-03, AAA-04, AAA-05, AAA-06, AAA-07, AAA-08, AAA-09, AAA-10, AAA-11, AAA-12, AAA-13, AAA-16, AAA-17, AAA-18, AAA-19, AAA-21, AAA-29, AAA-30, AAA-31
Contratos: C00, C01, C02, C03, C04, C05, C06, C07
Exclusividade do repositório: não
Locks de recursos: isolated-db:AAA-23, ports:AAA-23

Antes de começar, obter evidência revisada e integrada dos predecessores, conferir o SHA candidato e contratos vigentes. A presença neste catálogo não autoriza início nem demonstra prontidão.

## Decisões condicionantes

Nenhuma declarada.

## Leitura

- docs/auditorias/2026-09-12/RELATORIO.md
- package.json
- docs/execucao-aaa-2026-09-12/CONTRATOS.md
- docs/execucao-aaa-2026-09-12/QUALIDADE.json
- docs/execucao-aaa-2026-09-12/EXECUCAO_MULTIAGENTE.md

## Escrita permitida

- e2e
- apps/desk-api/src/__tests__
- apps/realtime-service/src/__tests__
- packages/media/src/__tests__
- modules/secretary-adapter/src/__tests__

## Escrita proibida

- docs/auditorias/2026-09-12
- .gauntlet
- .gauntlet-v2-archive-20260912
- docs/execucao-aaa-2026-09-12/BACKLOG.json

## Critérios de aceitação

- PostgreSQL/Redis/MinIO/ClamAV/OTel reais isolados; Gateway/Secretary sandbox distinguem contrato simulado e integração real.
- Login→inbound→atribuição→resposta→realtime→notas/tarefas→auditoria/privacidade validado via navegador.
- Permissões, HMAC/antirreplay, SSRF/mídia, falhas, retries e reconciliação têm negativos; suítes obrigatórias sem skip.
- Não chamar provider real de clientes nem enviar mensagens externas; sandbox/provider oficial de teste quando autorizado.

## Evidência e revisão

- diff e commit base/candidato + SHA-256 dos arquivos relevantes
- comandos executados, exit code e logs sanitizados; testes novos identificados
- reprodução negativa antes/depois e regressão da fronteira afetada
- review independente sem histórico e verificação de integridade antes/depois
- manifesto da evidência ligado ao contrato vigente; integração e reteste pelo lead

## Checks declarados (não executados por esta ferramenta)

EXISTING significa declarado existente; revalidar disponibilidade no candidato. TO_CREATE exige criar o check antes de executá-lo e registrar a evidência. Nenhuma declaração equivale a check aprovado.

### Existentes

- `pnpm test:postgres-real` — ambiente: isolated
- `pnpm test:e2e` — ambiente: isolated
- `STAGING_SMOKE=1 pnpm --filter @cvg/media test` — ambiente: isolated

### A criar

- `pnpm exec playwright test e2e/aaa/system.spec.ts --config playwright.aaa.config.ts` — ambiente: isolated

## Rollback

Trabalhar em branch/worktree isolada; preservar baseline e diff. Reverter apenas commits próprios ainda não integrados. Para mudança de schema, entregar procedimento expand/contract e roll-forward testado; nunca apagar dados de produção.

## Limite e replanejamento

Uma hipótese concreta por tentativa; até 2 retrabalhos sem nova decomposição. Replanejar se faltar evidência nova. Pontos expressam tamanho relativo, não horas nem limite de qualidade.

## Próxima ação

Revalidar os caminhos e o achado no candidato atual, obter dependências verificadas e reproduzir o caso negativo antes de alterar código.

## Retorno exigido

IMPLEMENTED (nunca DONE pelo builder)

Devolver arquivos alterados, checks realmente executados com resultados, evidências, limitações e riscos residuais. Revisão independente, integração e reteste pelo lead são condições separadas; não alterar status do catálogo nem declarar aceite automático.
