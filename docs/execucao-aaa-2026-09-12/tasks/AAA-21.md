# AAA-21 — Polir Login, Inbox, Dashboard e integração do cliente

> Gerado de BACKLOG.json por plan.py; não editar manualmente.

SIMULAÇÃO: todas as tarefas permanecem PLANNED. Cada lote é apenas uma sugestão condicionada à evidência, revisão e integração dos predecessores. Não lança agentes/serviços, não executa checks e não concede aceite.

Status: PLANNED | Responsável: frontend superfícies | Fase: 3 | Risco: R2 | Pontos: 8

## Objetivo

Login, Inbox e Dashboard cobertos pela matriz DESIGN_QA; contrato cliente para demais páginas integrado sem esconder falhas com mocks.

## Contexto e dependências

Achados: L01
Áreas: 9, 10
Predecessores: AAA-13, AAA-20, AAA-06, AAA-19
Contratos: C01, C04, C05, C06, C09
Exclusividade do repositório: não
Locks de recursos: isolated-db:AAA-21, ports:AAA-21

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

- apps/desk-web/src/pages/Login.tsx
- apps/desk-web/src/pages/Login.css
- apps/desk-web/src/pages/Inbox.tsx
- apps/desk-web/src/pages/Inbox.css
- apps/desk-web/src/pages/Dashboard.tsx
- apps/desk-web/src/pages/Dashboard.css
- apps/desk-web/src/App.tsx
- apps/desk-web/src/lib/api.ts
- apps/desk-web/src/store/auth.ts
- apps/desk-web/src/__tests__/aaa-21.test.tsx

## Escrita proibida

- docs/auditorias/2026-09-12
- .gauntlet
- .gauntlet-v2-archive-20260912
- docs/execucao-aaa-2026-09-12/BACKLOG.json

## Critérios de aceitação

- Login, Inbox e Dashboard cobertos pela matriz DESIGN_QA; contrato cliente para demais páginas integrado sem esconder falhas com mocks.
- Loading/empty/error/forbidden/offline/retry e sucesso refletem rede; indicador Online não é estático.
- Sessão expirada limpa estado sensível; navegação teclado/toque e operações preservam contexto.
- Render e interação verificáveis antes/depois, sem redesign arbitrário nem dados institucionais inventados.

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

### A criar

- `pnpm --filter @cvg/desk-web exec vitest run src/__tests__/aaa-21.test.tsx` — ambiente: browser-mocked

## Rollback

Trabalhar em branch/worktree isolada; preservar baseline e diff. Reverter apenas commits próprios ainda não integrados. Para mudança de schema, entregar procedimento expand/contract e roll-forward testado; nunca apagar dados de produção.

## Limite e replanejamento

Uma hipótese concreta por tentativa; até 2 retrabalhos sem nova decomposição. Replanejar se faltar evidência nova. Pontos expressam tamanho relativo, não horas nem limite de qualidade.

## Próxima ação

Revalidar os caminhos e o achado no candidato atual, obter dependências verificadas e reproduzir o caso negativo antes de alterar código.

## Retorno exigido

IMPLEMENTED (nunca DONE pelo builder)

Devolver arquivos alterados, checks realmente executados com resultados, evidências, limitações e riscos residuais. Revisão independente, integração e reteste pelo lead são condições separadas; não alterar status do catálogo nem declarar aceite automático.
