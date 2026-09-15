# AAA-12 — Garantir idempotência transacional no envio

> Gerado de BACKLOG.json por plan.py; não editar manualmente.

SIMULAÇÃO: todas as tarefas permanecem PLANNED. Cada lote é apenas uma sugestão condicionada à evidência, revisão e integração dos predecessores. Não lança agentes/serviços, não executa checks e não concede aceite.

Status: PLANNED | Responsável: backend mensagens | Fase: 2 | Risco: R2 | Pontos: 8

## Objetivo

Chave com escopo/TTL definidos e hash de payload; payload divergente com mesma chave retorna conflito.

## Contexto e dependências

Achados: A11
Áreas: 5, 6, 7
Predecessores: AAA-08, AAA-04
Contratos: C03, C04
Exclusividade do repositório: não
Locks de recursos: isolated-db:AAA-12, ports:AAA-12, schema-migrations

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

- modules/chat
- modules/gateway-adapter
- packages/database/src/schema.ts
- packages/database/supabase/migrations
- apps/desk-api/src/__tests__/aaa-12.integration.test.ts

## Escrita proibida

- docs/auditorias/2026-09-12
- .gauntlet
- .gauntlet-v2-archive-20260912
- docs/execucao-aaa-2026-09-12/BACKLOG.json

## Critérios de aceitação

- Chave com escopo/TTL definidos e hash de payload; payload divergente com mesma chave retorna conflito.
- Mensagem e delivery são atômicos; corrida perde sem linha órfã e sem segundo envio.
- Crash após aceite do provider exige reconciliação; nunca prometer exactly-once externo sem contrato do provider.

## Evidência e revisão

- diff e commit base/candidato + SHA-256 dos arquivos relevantes
- comandos executados, exit code e logs sanitizados; testes novos identificados
- reprodução negativa antes/depois e regressão da fronteira afetada
- review independente sem histórico e verificação de integridade antes/depois
- manifesto da evidência ligado ao contrato vigente; integração e reteste pelo lead

## Checks declarados (não executados por esta ferramenta)

EXISTING significa declarado existente; revalidar disponibilidade no candidato. TO_CREATE exige criar o check antes de executá-lo e registrar a evidência. Nenhuma declaração equivale a check aprovado.

### Existentes

- `pnpm --filter @cvg/desk-api exec vitest run src/__tests__/outbound-idempotency.integration.test.ts` — ambiente: isolated

### A criar

- `pnpm --filter @cvg/desk-api exec vitest run src/__tests__/aaa-12.integration.test.ts` — ambiente: isolated

## Rollback

Trabalhar em branch/worktree isolada; preservar baseline e diff. Reverter apenas commits próprios ainda não integrados. Para mudança de schema, entregar procedimento expand/contract e roll-forward testado; nunca apagar dados de produção.

## Limite e replanejamento

Uma hipótese concreta por tentativa; até 2 retrabalhos sem nova decomposição. Replanejar se faltar evidência nova. Pontos expressam tamanho relativo, não horas nem limite de qualidade.

## Próxima ação

Revalidar os caminhos e o achado no candidato atual, obter dependências verificadas e reproduzir o caso negativo antes de alterar código.

## Retorno exigido

IMPLEMENTED (nunca DONE pelo builder)

Devolver arquivos alterados, checks realmente executados com resultados, evidências, limitações e riscos residuais. Revisão independente, integração e reteste pelo lead são condições separadas; não alterar status do catálogo nem declarar aceite automático.
