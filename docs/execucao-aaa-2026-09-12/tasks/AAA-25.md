# AAA-25 — Medir carga, falhas, observabilidade e UX performance

> Gerado de BACKLOG.json por plan.py; não editar manualmente.

SIMULAÇÃO: todas as tarefas permanecem PLANNED. Cada lote é apenas uma sugestão condicionada à evidência, revisão e integração dos predecessores. Não lança agentes/serviços, não executa checks e não concede aceite.

Status: PLANNED | Responsável: SRE performance | Fase: 4 | Risco: R2 | Pontos: 8

## Objetivo

Dataset e perfil fixados: 10k conversas, 100k mensagens, 100 sessões, 10min aquecimento+30min medição; registrar hardware/versões/rede e 3 execuções.

## Contexto e dependências

Achados: L01
Áreas: 6, 8, 12, 13
Predecessores: AAA-07, AAA-08, AAA-11, AAA-18, AAA-21, AAA-16, AAA-29, AAA-30, AAA-31
Contratos: C00, C03, C08, C09
Exclusividade do repositório: não
Locks de recursos: isolated-db:AAA-25, ports:AAA-25

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

- infra/scripts
- infra/prometheus
- infra/otel
- infra/grafana
- docs/SLO.md
- e2e/aaa/performance.spec.ts

## Escrita proibida

- docs/auditorias/2026-09-12
- .gauntlet
- .gauntlet-v2-archive-20260912
- docs/execucao-aaa-2026-09-12/BACKLOG.json

## Critérios de aceitação

- Dataset e perfil fixados: 10k conversas, 100k mensagens, 100 sessões, 10min aquecimento+30min medição; registrar hardware/versões/rede e 3 execuções.
- P95 inbound <250ms e realtime <500ms; erros inesperados <0,1%; perda/duplicação de efeitos nos cenários determinísticos igual a zero.
- Browser LCP<=2,5s INP<=200ms CLS<=0,1 no perfil definido; separar laboratório de percentil de campo.
- Collector recebe spans correlacionados; dashboards e alertas disparam e recuperam em falhas injetadas; SLO mensal não é provado por ensaio curto.
- Corrigir definição e aritmética de SLO em docs/SLO.md: janela mensal explícita, consultas válidas e duplicação de efeito distinta de dedup bem-sucedida.

## Evidência e revisão

- diff e commit base/candidato + SHA-256 dos arquivos relevantes
- comandos executados, exit code e logs sanitizados; testes novos identificados
- reprodução negativa antes/depois e regressão da fronteira afetada
- review independente sem histórico e verificação de integridade antes/depois
- manifesto da evidência ligado ao contrato vigente; integração e reteste pelo lead

## Checks declarados (não executados por esta ferramenta)

EXISTING significa declarado existente; revalidar disponibilidade no candidato. TO_CREATE exige criar o check antes de executá-lo e registrar a evidência. Nenhuma declaração equivale a check aprovado.

### Existentes

- `node infra/scripts/query-performance.mjs` — ambiente: isolated
- `node scripts/otel-e2e-check.mjs` — ambiente: isolated

### A criar

- `pnpm exec playwright test e2e/aaa/performance.spec.ts --config playwright.aaa.config.ts` — ambiente: isolated
- `node infra/scripts/aaa-load.mjs` — ambiente: isolated load profile C00

## Rollback

Trabalhar em branch/worktree isolada; preservar baseline e diff. Reverter apenas commits próprios ainda não integrados. Para mudança de schema, entregar procedimento expand/contract e roll-forward testado; nunca apagar dados de produção.

## Limite e replanejamento

Uma hipótese concreta por tentativa; até 2 retrabalhos sem nova decomposição. Replanejar se faltar evidência nova. Pontos expressam tamanho relativo, não horas nem limite de qualidade.

## Próxima ação

Revalidar os caminhos e o achado no candidato atual, obter dependências verificadas e reproduzir o caso negativo antes de alterar código.

## Retorno exigido

IMPLEMENTED (nunca DONE pelo builder)

Devolver arquivos alterados, checks realmente executados com resultados, evidências, limitações e riscos residuais. Revisão independente, integração e reteste pelo lead são condições separadas; não alterar status do catálogo nem declarar aceite automático.
