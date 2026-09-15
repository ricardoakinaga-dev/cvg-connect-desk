# AAA-20 — Consolidar design system operacional CVG

> Gerado de BACKLOG.json por plan.py; não editar manualmente.

SIMULAÇÃO: todas as tarefas permanecem PLANNED. Cada lote é apenas uma sugestão condicionada à evidência, revisão e integração dos predecessores. Não lança agentes/serviços, não executa checks e não concede aceite.

Status: PLANNED | Responsável: frontend design system | Fase: 2 | Risco: R2 | Pontos: 5

## Objetivo

Preservar marca/assets existentes; inventariar tokens, componentes, estados e regras de densidade sem mudar contratos backend.

## Contexto e dependências

Achados: L01
Áreas: 9, 10
Predecessores: AAA-01
Contratos: C09
Exclusividade do repositório: não
Locks de recursos: isolated-db:AAA-20, ports:AAA-20

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

- apps/desk-web/src/index.css
- apps/desk-web/src/premium-surfaces.css
- apps/desk-web/src/components
- apps/desk-web/src/hooks
- docs/design
- apps/desk-web/src/pages/EntityPages.css

## Escrita proibida

- docs/auditorias/2026-09-12
- .gauntlet
- .gauntlet-v2-archive-20260912
- docs/execucao-aaa-2026-09-12/BACKLOG.json

## Critérios de aceitação

- Preservar marca/assets existentes; inventariar tokens, componentes, estados e regras de densidade sem mudar contratos backend.
- Tokens semânticos, tipografia e primitivas documentadas cobrem foco, disabled, loading, error e status sem depender de cor.
- Shell 375/390/768/1024/1440 sem overflow global; navegação e foco em painel mobile funcionam.
- Tokens/assets têm procedência e orçamento; geração externa de imagens é opcional e não condição inventada de aceite.

## Evidência e revisão

- diff e commit base/candidato + SHA-256 dos arquivos relevantes
- comandos executados, exit code e logs sanitizados; testes novos identificados
- reprodução negativa antes/depois e regressão da fronteira afetada
- review independente sem histórico e verificação de integridade antes/depois
- manifesto da evidência ligado ao contrato vigente; integração e reteste pelo lead

## Checks declarados (não executados por esta ferramenta)

EXISTING significa declarado existente; revalidar disponibilidade no candidato. TO_CREATE exige criar o check antes de executá-lo e registrar a evidência. Nenhuma declaração equivale a check aprovado.

### Existentes

- `pnpm --filter @cvg/desk-web test` — ambiente: local
- `pnpm --filter @cvg/desk-web build` — ambiente: local

### A criar

Nenhum declarado.

## Rollback

Trabalhar em branch/worktree isolada; preservar baseline e diff. Reverter apenas commits próprios ainda não integrados. Para mudança de schema, entregar procedimento expand/contract e roll-forward testado; nunca apagar dados de produção.

## Limite e replanejamento

Uma hipótese concreta por tentativa; até 2 retrabalhos sem nova decomposição. Replanejar se faltar evidência nova. Pontos expressam tamanho relativo, não horas nem limite de qualidade.

## Próxima ação

Revalidar os caminhos e o achado no candidato atual, obter dependências verificadas e reproduzir o caso negativo antes de alterar código.

## Retorno exigido

IMPLEMENTED (nunca DONE pelo builder)

Devolver arquivos alterados, checks realmente executados com resultados, evidências, limitações e riscos residuais. Revisão independente, integração e reteste pelo lead são condições separadas; não alterar status do catálogo nem declarar aceite automático.
