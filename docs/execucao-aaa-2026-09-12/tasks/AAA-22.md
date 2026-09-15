# AAA-22 — Validar acessibilidade e excelência visual independente

> Gerado de BACKLOG.json por plan.py; não editar manualmente.

SIMULAÇÃO: todas as tarefas permanecem PLANNED. Cada lote é apenas uma sugestão condicionada à evidência, revisão e integração dos predecessores. Não lança agentes/serviços, não executa checks e não concede aceite.

Status: PLANNED | Responsável: QA acessibilidade + críticos visuais | Fase: 4 | Risco: R2 | Pontos: 5

## Objetivo

Matriz rota/estado/viewport executada; teclado, foco, zoom, leitor de tela e reduced-motion registrados.

## Contexto e dependências

Achados: L01
Áreas: 9, 10
Predecessores: AAA-21, AAA-29, AAA-30, AAA-31, AAA-16
Contratos: C09
Exclusividade do repositório: não
Locks de recursos: isolated-db:AAA-22, ports:AAA-22

Antes de começar, obter evidência revisada e integrada dos predecessores, conferir o SHA candidato e contratos vigentes. A presença neste catálogo não autoriza início nem demonstra prontidão.

## Decisões condicionantes

Nenhuma declarada.

## Leitura

- docs/auditorias/2026-09-12/RELATORIO.md
- package.json
- docs/execucao-aaa-2026-09-12/CONTRATOS.md
- docs/execucao-aaa-2026-09-12/QUALIDADE.json
- docs/execucao-aaa-2026-09-12/EXECUCAO_MULTIAGENTE.md
- docs/execucao-aaa-2026-09-12/DESIGN_QA.md

## Escrita permitida

- e2e/aaa
- playwright.config.ts
- docs/execucao-aaa-2026-09-12/runtime/visual
- e2e/aaa/accessibility.spec.ts
- e2e/aaa/visual.spec.ts

## Escrita proibida

- docs/auditorias/2026-09-12
- .gauntlet
- .gauntlet-v2-archive-20260912
- docs/execucao-aaa-2026-09-12/BACKLOG.json

## Critérios de aceitação

- Matriz rota/estado/viewport executada; teclado, foco, zoom, leitor de tela e reduced-motion registrados.
- WCAG 2.2 AA aplicável sem falhas essenciais; relatório completo de critérios aplicáveis, não só axe.
- Dois críticos visuais sem histórico recebem A/B aleatório e rubric completa; terceiro adjudica desacordo.
- Pontuação visual ponderada >=95/100, confiança alta, sem Critical/High; casos não executados impedem AAA.

## Evidência e revisão

- diff e commit base/candidato + SHA-256 dos arquivos relevantes
- comandos executados, exit code e logs sanitizados; testes novos identificados
- reprodução negativa antes/depois e regressão da fronteira afetada
- review independente sem histórico e verificação de integridade antes/depois
- manifesto da evidência ligado ao contrato vigente; integração e reteste pelo lead

## Checks declarados (não executados por esta ferramenta)

EXISTING significa declarado existente; revalidar disponibilidade no candidato. TO_CREATE exige criar o check antes de executá-lo e registrar a evidência. Nenhuma declaração equivale a check aprovado.

### Existentes

Nenhum declarado.

### A criar

- `pnpm exec playwright test e2e/aaa/accessibility.spec.ts e2e/aaa/visual.spec.ts --config playwright.aaa.config.ts` — ambiente: isolated

## Rollback

Trabalhar em branch/worktree isolada; preservar baseline e diff. Reverter apenas commits próprios ainda não integrados. Para mudança de schema, entregar procedimento expand/contract e roll-forward testado; nunca apagar dados de produção.

## Limite e replanejamento

Uma hipótese concreta por tentativa; até 2 retrabalhos sem nova decomposição. Replanejar se faltar evidência nova. Pontos expressam tamanho relativo, não horas nem limite de qualidade.

## Próxima ação

Revalidar os caminhos e o achado no candidato atual, obter dependências verificadas e reproduzir o caso negativo antes de alterar código.

## Retorno exigido

IMPLEMENTED (nunca DONE pelo builder)

Devolver arquivos alterados, checks realmente executados com resultados, evidências, limitações e riscos residuais. Revisão independente, integração e reteste pelo lead são condições separadas; não alterar status do catálogo nem declarar aceite automático.
