# AAA-28 — Gauntlet final do candidato integrado

> Gerado de BACKLOG.json por plan.py; não editar manualmente.

SIMULAÇÃO: todas as tarefas permanecem PLANNED. Cada lote é apenas uma sugestão condicionada à evidência, revisão e integração dos predecessores. Não lança agentes/serviços, não executa checks e não concede aceite.

Status: PLANNED | Responsável: crítico final fresco + lead | Fase: 5 | Risco: R2 | Pontos: 5

## Objetivo

Novo crítico sem histórico, distinto dos anteriores e read-only, inspeciona código/artefatos e executa checks no candidato integrado.

## Contexto e dependências

Achados: A01, A02, A03, A04, A05, A06, A07, A08, A09, A10, A11, A12, A13, A14, A15, A16, L01
Áreas: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18
Predecessores: AAA-00, AAA-01, AAA-02, AAA-03, AAA-04, AAA-05, AAA-06, AAA-07, AAA-08, AAA-09, AAA-10, AAA-11, AAA-12, AAA-13, AAA-14, AAA-15, AAA-16, AAA-17, AAA-18, AAA-19, AAA-20, AAA-21, AAA-22, AAA-23, AAA-24, AAA-25, AAA-26, AAA-27, AAA-29, AAA-30, AAA-31
Contratos: C00, C01, C02, C03, C04, C05, C06, C07, C08, C09
Exclusividade do repositório: não
Locks de recursos: isolated-db:AAA-28, ports:AAA-28

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

- docs/execucao-aaa-2026-09-12/runtime/final

## Escrita proibida

- docs/auditorias/2026-09-12
- .gauntlet
- .gauntlet-v2-archive-20260912
- docs/execucao-aaa-2026-09-12/BACKLOG.json

## Critérios de aceitação

- Novo crítico sem histórico, distinto dos anteriores e read-only, inspeciona código/artefatos e executa checks no candidato integrado.
- Todos gates obrigatórios PASS/current; nenhum P0/P1 High/Critical aberto; produto >=95/100 e cada área >=90/100.
- Reproduções históricas convertem-se em testes que rejeitam o bug; original conhecido ruim deve falhar o harness de aceitação.
- Ata separa candidato técnico aprovado de autorização de deploy; evidência ausente resulta NOT_VERIFIED ou FAIL, nunca certificado.

## Evidência e revisão

- diff e commit base/candidato + SHA-256 dos arquivos relevantes
- comandos executados, exit code e logs sanitizados; testes novos identificados
- reprodução negativa antes/depois e regressão da fronteira afetada
- review independente sem histórico e verificação de integridade antes/depois
- manifesto da evidência ligado ao contrato vigente; integração e reteste pelo lead

## Checks declarados (não executados por esta ferramenta)

EXISTING significa declarado existente; revalidar disponibilidade no candidato. TO_CREATE exige criar o check antes de executá-lo e registrar a evidência. Nenhuma declaração equivale a check aprovado.

### Existentes

- `pnpm lint` — ambiente: local
- `pnpm typecheck` — ambiente: local
- `pnpm test` — ambiente: isolated
- `pnpm build` — ambiente: local
- `pnpm test:postgres-real` — ambiente: isolated
- `pnpm test:e2e` — ambiente: isolated

### A criar

- `pnpm exec playwright test --config playwright.aaa.config.ts` — ambiente: isolated, harness created by AAA-00 and suites AAA-22/23/25

## Rollback

Trabalhar em branch/worktree isolada; preservar baseline e diff. Reverter apenas commits próprios ainda não integrados. Para mudança de schema, entregar procedimento expand/contract e roll-forward testado; nunca apagar dados de produção.

## Limite e replanejamento

Uma hipótese concreta por tentativa; até 2 retrabalhos sem nova decomposição. Replanejar se faltar evidência nova. Pontos expressam tamanho relativo, não horas nem limite de qualidade.

## Próxima ação

Revalidar os caminhos e o achado no candidato atual, obter dependências verificadas e reproduzir o caso negativo antes de alterar código.

## Retorno exigido

IMPLEMENTED (nunca DONE pelo builder)

Devolver arquivos alterados, checks realmente executados com resultados, evidências, limitações e riscos residuais. Revisão independente, integração e reteste pelo lead são condições separadas; não alterar status do catálogo nem declarar aceite automático.
