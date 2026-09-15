# AAA-00 — Revalidar baseline e preparar infraestrutura isolada

> Gerado de BACKLOG.json por plan.py; não editar manualmente.

SIMULAÇÃO: todas as tarefas permanecem PLANNED. Cada lote é apenas uma sugestão condicionada à evidência, revisão e integração dos predecessores. Não lança agentes/serviços, não executa checks e não concede aceite.

Status: PLANNED | Responsável: lead + QA infraestrutura | Fase: 0 | Risco: R2 | Pontos: 3

## Objetivo

Registrar commit, worktree e hashes; preservar relatório e runs gauntlet anteriores.

## Contexto e dependências

Achados: L01
Áreas: 14, 18
Predecessores: nenhum
Contratos: C00
Exclusividade do repositório: não
Locks de recursos: compose-topology, isolated-db:AAA-00, ports:AAA-00, schema-migrations

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

- e2e/support
- docker-compose.smoke.yml
- docs/execucao-aaa-2026-09-12/runtime
- playwright.aaa.config.ts
- packages/database/src/schema.d.ts
- packages/database/src/schema.d.ts.map

## Escrita proibida

- docs/auditorias/2026-09-12
- .gauntlet
- .gauntlet-v2-archive-20260912
- docs/execucao-aaa-2026-09-12/BACKLOG.json

## Critérios de aceitação

- Registrar commit, worktree e hashes; preservar relatório e runs gauntlet anteriores.
- Descobrir PostgreSQL/Redis local dedicado ou CI efêmero sem depender exclusivamente de Docker; recusar banco sem marcador de teste.
- Produzir fixtures sintéticas, portas exclusivas por worker, comando de teardown restrito e inventário de checks existentes.
- Fixar dataset e perfil de benchmark e demonstrar falha deliberada do harness; nada de green por skip.
- Criar playwright.aaa.config.ts para e2e/aaa em stack isolada; manter smoke original independente e documentar invocação explícita dos dois conjuntos.
- Inventariar serviços exigidos em cada gate e provisionar MinIO/ClamAV/OTel isolados antes dos cartões que exigem sua prova; nenhuma dependência posterior pode ser usada como pré-requisito implícito de aceite anterior.

## Evidência e revisão

- diff e commit base/candidato + SHA-256 dos arquivos relevantes
- comandos executados, exit code e logs sanitizados; testes novos identificados
- reprodução negativa antes/depois e regressão da fronteira afetada
- review independente sem histórico e verificação de integridade antes/depois
- manifesto da evidência ligado ao contrato vigente; integração e reteste pelo lead

## Checks declarados (não executados por esta ferramenta)

EXISTING significa declarado existente; revalidar disponibilidade no candidato. TO_CREATE exige criar o check antes de executá-lo e registrar a evidência. Nenhuma declaração equivale a check aprovado.

### Existentes

- `git status --short` — ambiente: read-only
- `pnpm --filter @cvg/database db:types` — ambiente: local
- `pnpm --filter @cvg/desk-web test` — ambiente: local

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
