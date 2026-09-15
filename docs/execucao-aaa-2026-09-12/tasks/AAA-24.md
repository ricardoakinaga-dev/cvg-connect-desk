# AAA-24 — Comprovar migrations e recuperação de desastre

> Gerado de BACKLOG.json por plan.py; não editar manualmente.

SIMULAÇÃO: todas as tarefas permanecem PLANNED. Cada lote é apenas uma sugestão condicionada à evidência, revisão e integração dos predecessores. Não lança agentes/serviços, não executa checks e não concede aceite.

Status: PLANNED | Responsável: DBA/SRE | Fase: 4 | Risco: R2 | Pontos: 5

## Objetivo

Aplicar migrations em banco vazio e cópia sintética anterior; checksum/schema corretos.

## Contexto e dependências

Achados: L01
Áreas: 5, 18
Predecessores: AAA-08, AAA-12, AAA-17, AAA-16
Contratos: C00, C03, C07, C08
Exclusividade do repositório: não
Locks de recursos: isolated-db:AAA-24, ports:AAA-24, schema-migrations

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
- packages/database/src/check-migrations.ts
- docs/DISASTER_RECOVERY.md
- .github/workflows/dr-e2e.yml

## Escrita proibida

- docs/auditorias/2026-09-12
- .gauntlet
- .gauntlet-v2-archive-20260912
- docs/execucao-aaa-2026-09-12/BACKLOG.json

## Critérios de aceitação

- Aplicar migrations em banco vazio e cópia sintética anterior; checksum/schema corretos.
- Backup→destruir apenas DB marcado de teste→restore→integridade→boot→smoke com evidência real.
- RPO <=24h e RTO <=2h conforme política existente; demonstrar ensaio cronometrado e procedimento de execução contínua.
- Testar corrupção de backup, checksum, retenção e reaplicação da política de privacidade após restore.

## Evidência e revisão

- diff e commit base/candidato + SHA-256 dos arquivos relevantes
- comandos executados, exit code e logs sanitizados; testes novos identificados
- reprodução negativa antes/depois e regressão da fronteira afetada
- review independente sem histórico e verificação de integridade antes/depois
- manifesto da evidência ligado ao contrato vigente; integração e reteste pelo lead

## Checks declarados (não executados por esta ferramenta)

EXISTING significa declarado existente; revalidar disponibilidade no candidato. TO_CREATE exige criar o check antes de executá-lo e registrar a evidência. Nenhuma declaração equivale a check aprovado.

### Existentes

- `bash infra/scripts/dr-e2e.sh` — ambiente: disposable database ONLY

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
