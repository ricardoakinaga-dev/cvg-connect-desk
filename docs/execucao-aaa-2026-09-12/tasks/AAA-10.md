# AAA-10 — Unificar contrato e segurança de anexos

> Gerado de BACKLOG.json por plan.py; não editar manualmente.

SIMULAÇÃO: todas as tarefas permanecem PLANNED. Cada lote é apenas uma sugestão condicionada à evidência, revisão e integração dos predecessores. Não lança agentes/serviços, não executa checks e não concede aceite.

Status: PLANNED | Responsável: backend mídia | Fase: 2 | Risco: R2 | Pontos: 8

## Objetivo

Arquivo 16 MiB passa por transporte definido; excesso falha com 413 e contrato de erro recuperável.

## Contexto e dependências

Achados: A09
Áreas: 4, 11
Predecessores: AAA-01
Contratos: C05
Exclusividade do repositório: não
Locks de recursos: compose-topology, isolated-db:AAA-10, ports:AAA-10

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

- packages/media
- packages/shared/src/media-policy.ts
- modules/chat/src/application/use-cases/send-outbound-message.use-case.ts
- modules/chat/src/presentation
- apps/desk-api/src/app.ts
- apps/desk-web/nginx.conf
- docker-compose.yml
- apps/desk-api/src/__tests__/aaa-10.integration.test.ts

## Escrita proibida

- docs/auditorias/2026-09-12
- .gauntlet
- .gauntlet-v2-archive-20260912
- docs/execucao-aaa-2026-09-12/BACKLOG.json

## Critérios de aceitação

- Arquivo 16 MiB passa por transporte definido; excesso falha com 413 e contrato de erro recuperável.
- Documentos só podem ser entregues após CLEAN; scanner ausente/timeout/infectado bloqueia e preserva quarentena.
- Validar tamanho real, MIME/magic bytes, URL/destino, redirecionamentos e armazenamento privado.
- MinIO e ClamAV reais com clean/EICAR/timeout; configuração implantada habilita a política definida.

## Evidência e revisão

- diff e commit base/candidato + SHA-256 dos arquivos relevantes
- comandos executados, exit code e logs sanitizados; testes novos identificados
- reprodução negativa antes/depois e regressão da fronteira afetada
- review independente sem histórico e verificação de integridade antes/depois
- manifesto da evidência ligado ao contrato vigente; integração e reteste pelo lead

## Checks declarados (não executados por esta ferramenta)

EXISTING significa declarado existente; revalidar disponibilidade no candidato. TO_CREATE exige criar o check antes de executá-lo e registrar a evidência. Nenhuma declaração equivale a check aprovado.

### Existentes

- `pnpm --filter @cvg/media test` — ambiente: isolated

### A criar

- `pnpm --filter @cvg/desk-api exec vitest run src/__tests__/aaa-10.integration.test.ts` — ambiente: isolated

## Rollback

Trabalhar em branch/worktree isolada; preservar baseline e diff. Reverter apenas commits próprios ainda não integrados. Para mudança de schema, entregar procedimento expand/contract e roll-forward testado; nunca apagar dados de produção.

## Limite e replanejamento

Uma hipótese concreta por tentativa; até 2 retrabalhos sem nova decomposição. Replanejar se faltar evidência nova. Pontos expressam tamanho relativo, não horas nem limite de qualidade.

## Próxima ação

Revalidar os caminhos e o achado no candidato atual, obter dependências verificadas e reproduzir o caso negativo antes de alterar código.

## Retorno exigido

IMPLEMENTED (nunca DONE pelo builder)

Devolver arquivos alterados, checks realmente executados com resultados, evidências, limitações e riscos residuais. Revisão independente, integração e reteste pelo lead são condições separadas; não alterar status do catálogo nem declarar aceite automático.
