# AAA-15 — Atualizar dependências e triar alertas

> Gerado de BACKLOG.json por plan.py; não editar manualmente.

SIMULAÇÃO: todas as tarefas permanecem PLANNED. Cada lote é apenas uma sugestão condicionada à evidência, revisão e integração dos predecessores. Não lança agentes/serviços, não executa checks e não concede aceite.

Status: PLANNED | Responsável: plataforma supply chain | Fase: 1 | Risco: R2 | Pontos: 5

## Objetivo

Triar caminhos runtime/dev e configuração atingida para cada alerta, registrar correção/exceção com expiração.

## Contexto e dependências

Achados: A13
Áreas: 16
Predecessores: AAA-02
Contratos: C08
Exclusividade do repositório: sim
Locks de recursos: dependency-graph, isolated-db:AAA-15, ports:AAA-15

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

- package.json
- pnpm-lock.yaml
- apps
- packages
- modules

## Escrita proibida

- docs/auditorias/2026-09-12
- .gauntlet
- .gauntlet-v2-archive-20260912
- docs/execucao-aaa-2026-09-12/BACKLOG.json

## Critérios de aceitação

- Triar caminhos runtime/dev e configuração atingida para cada alerta, registrar correção/exceção com expiração.
- Nenhum Critical/High explorável ou sem triagem no candidato; objetivo zero High/Critical nas dependências implantadas.
- Atualizar por grupos compatíveis, registrar changelog e testar contratos afetados; não suprimir scanner.
- Ownership amplo limita-se a manifests e lockfile; qualquer mudança de fonte exige redistribuição pelo lead.

## Evidência e revisão

- diff e commit base/candidato + SHA-256 dos arquivos relevantes
- comandos executados, exit code e logs sanitizados; testes novos identificados
- reprodução negativa antes/depois e regressão da fronteira afetada
- review independente sem histórico e verificação de integridade antes/depois
- manifesto da evidência ligado ao contrato vigente; integração e reteste pelo lead

## Checks declarados (não executados por esta ferramenta)

EXISTING significa declarado existente; revalidar disponibilidade no candidato. TO_CREATE exige criar o check antes de executá-lo e registrar a evidência. Nenhuma declaração equivale a check aprovado.

### Existentes

- `pnpm audit --json` — ambiente: network
- `pnpm audit --prod --json` — ambiente: network
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
