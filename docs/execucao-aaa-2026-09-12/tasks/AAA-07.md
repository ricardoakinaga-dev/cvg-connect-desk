# AAA-07 — Implementar lease e ACK cercado por proprietário

> Gerado de BACKLOG.json por plan.py; não editar manualmente.

SIMULAÇÃO: todas as tarefas permanecem PLANNED. Cada lote é apenas uma sugestão condicionada à evidência, revisão e integração dos predecessores. Não lança agentes/serviços, não executa checks e não concede aceite.

Status: PLANNED | Responsável: backend eventos/dados | Fase: 2 | Risco: R2 | Pontos: 8

## Objetivo

Claim atômico por consumidor com lease_owner, lease_until e fencing; stale ACK não finaliza lease novo.

## Contexto e dependências

Achados: A06
Áreas: 5, 6, 12
Predecessores: AAA-02, AAA-01
Contratos: C03
Exclusividade do repositório: não
Locks de recursos: isolated-db:AAA-07, ports:AAA-07, schema-migrations

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

- packages/events
- packages/database/src/schema.ts
- packages/database/supabase/migrations
- apps/message-worker
- apps/realtime-service/src/index.ts
- apps/desk-api/src/app.ts
- packages/events/src/__tests__/aaa-07-lease-real.test.ts

## Escrita proibida

- docs/auditorias/2026-09-12
- .gauntlet
- .gauntlet-v2-archive-20260912
- docs/execucao-aaa-2026-09-12/BACKLOG.json

## Critérios de aceitação

- Claim atômico por consumidor com lease_owner, lease_until e fencing; stale ACK não finaliza lease novo.
- Worker, realtime e HTTP usam mesma semântica de claim; limitar/validar since antes de reservar.
- Dois workers do mesmo consumidor não processam lease simultâneo; queda recupera; consumidores diferentes permanecem independentes.

## Evidência e revisão

- diff e commit base/candidato + SHA-256 dos arquivos relevantes
- comandos executados, exit code e logs sanitizados; testes novos identificados
- reprodução negativa antes/depois e regressão da fronteira afetada
- review independente sem histórico e verificação de integridade antes/depois
- manifesto da evidência ligado ao contrato vigente; integração e reteste pelo lead

## Checks declarados (não executados por esta ferramenta)

EXISTING significa declarado existente; revalidar disponibilidade no candidato. TO_CREATE exige criar o check antes de executá-lo e registrar a evidência. Nenhuma declaração equivale a check aprovado.

### Existentes

- `pnpm --filter @cvg/events test:real-db` — ambiente: isolated

### A criar

- `pnpm --filter @cvg/events exec vitest run src/__tests__/aaa-07-lease-real.test.ts` — ambiente: isolated

## Rollback

Trabalhar em branch/worktree isolada; preservar baseline e diff. Reverter apenas commits próprios ainda não integrados. Para mudança de schema, entregar procedimento expand/contract e roll-forward testado; nunca apagar dados de produção.

## Limite e replanejamento

Uma hipótese concreta por tentativa; até 2 retrabalhos sem nova decomposição. Replanejar se faltar evidência nova. Pontos expressam tamanho relativo, não horas nem limite de qualidade.

## Próxima ação

Revalidar os caminhos e o achado no candidato atual, obter dependências verificadas e reproduzir o caso negativo antes de alterar código.

## Retorno exigido

IMPLEMENTED (nunca DONE pelo builder)

Devolver arquivos alterados, checks realmente executados com resultados, evidências, limitações e riscos residuais. Revisão independente, integração e reteste pelo lead são condições separadas; não alterar status do catálogo nem declarar aceite automático.
