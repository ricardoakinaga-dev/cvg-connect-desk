# AAA-01 — Congelar contratos e decisões de fronteira

> Gerado de BACKLOG.json por plan.py; não editar manualmente.

SIMULAÇÃO: todas as tarefas permanecem PLANNED. Cada lote é apenas uma sugestão condicionada à evidência, revisão e integração dos predecessores. Não lança agentes/serviços, não executa checks e não concede aceite.

Status: PLANNED | Responsável: lead arquitetura/produto | Fase: 0 | Risco: R2 | Pontos: 3

## Objetivo

Definir esquema de sessão, identidade, acesso por conversa e entrega realtime sem conteúdo global.

## Contexto e dependências

Achados: L01
Áreas: 1, 2, 3, 5, 6, 9, 11, 17
Predecessores: AAA-00
Contratos: C00, C01, C02, C03, C04, C05, C06, C07, C08, C09
Exclusividade do repositório: não
Locks de recursos: isolated-db:AAA-01, ports:AAA-01

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

- docs/execucao-aaa-2026-09-12/CONTRATOS.md
- docs/execucao-aaa-2026-09-12/DECISOES.md

## Escrita proibida

- docs/auditorias/2026-09-12
- .gauntlet
- .gauntlet-v2-archive-20260912
- docs/execucao-aaa-2026-09-12/BACKLOG.json

## Critérios de aceitação

- Definir esquema de sessão, identidade, acesso por conversa e entrega realtime sem conteúdo global.
- Definir contratos transacionais e de lease/ACK, idempotência, paginação, erro e upload.
- Resolver D01–D04 ou registrar tarefa dependente como bloqueada; decisões de retenção não são presumidas pelo agente.
- Versionar contratos e consumidores; alterar contrato invalida dependentes até revisão.
- Entregar tabela para C00–C09: produtor/consumidores, schema/exemplo positivo/exemplo negativo, política de erro, teste de consumidor, compatibilidade, versão e decisão pendente. Revisor deve testar a coerência semântica, não só plan.py validate.

## Evidência e revisão

- diff e commit base/candidato + SHA-256 dos arquivos relevantes
- comandos executados, exit code e logs sanitizados; testes novos identificados
- reprodução negativa antes/depois e regressão da fronteira afetada
- review independente sem histórico e verificação de integridade antes/depois
- manifesto da evidência ligado ao contrato vigente; integração e reteste pelo lead

## Checks declarados (não executados por esta ferramenta)

EXISTING significa declarado existente; revalidar disponibilidade no candidato. TO_CREATE exige criar o check antes de executá-lo e registrar a evidência. Nenhuma declaração equivale a check aprovado.

### Existentes

- `python3 docs/execucao-aaa-2026-09-12/plan.py validate` — ambiente: read-only

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
