# AAA-05 — Isolar canais e destinatários realtime

> Gerado de BACKLOG.json por plan.py; não editar manualmente.

SIMULAÇÃO: todas as tarefas permanecem PLANNED. Cada lote é apenas uma sugestão condicionada à evidência, revisão e integração dos predecessores. Não lança agentes/serviços, não executa checks e não concede aceite.

Status: PLANNED | Responsável: backend realtime | Fase: 1 | Risco: R2 | Pontos: 8

## Objetivo

Remover payloads sensíveis do global; autorizar subscription e envio por destinatário, não só handshake.

## Contexto e dependências

Achados: A03
Áreas: 3, 8
Predecessores: AAA-04
Contratos: C01, C02, C03
Exclusividade do repositório: não
Locks de recursos: isolated-db:AAA-05, ports:AAA-05

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

- apps/realtime-service
- packages/realtime
- apps/desk-api/src/internal-auth.ts
- apps/desk-api/src/app.ts
- apps/desk-api/src/__tests__/aaa-05.integration.test.ts
- apps/realtime-service/src/__tests__/aaa-05-isolation.test.ts

## Escrita proibida

- docs/auditorias/2026-09-12
- .gauntlet
- .gauntlet-v2-archive-20260912
- docs/execucao-aaa-2026-09-12/BACKLOG.json

## Critérios de aceitação

- Remover payloads sensíveis do global; autorizar subscription e envio por destinatário, não só handshake.
- Revalidar sessão e membership durante conexão; limitar payload/inscrições e fechar em falha de autorização.
- Sockets reais de setores A/B comprovam isolamento, reconexão, revogação e três réplicas sem vazamento.
- Retirada de acesso interrompe entrega em no máximo 5 s no perfil de C00; deadline inclui cache/revalidação, não só periodicidade de timer.

## Evidência e revisão

- diff e commit base/candidato + SHA-256 dos arquivos relevantes
- comandos executados, exit code e logs sanitizados; testes novos identificados
- reprodução negativa antes/depois e regressão da fronteira afetada
- review independente sem histórico e verificação de integridade antes/depois
- manifesto da evidência ligado ao contrato vigente; integração e reteste pelo lead

## Checks declarados (não executados por esta ferramenta)

EXISTING significa declarado existente; revalidar disponibilidade no candidato. TO_CREATE exige criar o check antes de executá-lo e registrar a evidência. Nenhuma declaração equivale a check aprovado.

### Existentes

- `pnpm --filter @cvg/realtime-service exec vitest run src/__tests__/realtime-auth-behavioral.test.ts` — ambiente: isolated

### A criar

- `pnpm --filter @cvg/realtime-service exec vitest run src/__tests__/aaa-05-isolation.test.ts` — ambiente: isolated

## Rollback

Trabalhar em branch/worktree isolada; preservar baseline e diff. Reverter apenas commits próprios ainda não integrados. Para mudança de schema, entregar procedimento expand/contract e roll-forward testado; nunca apagar dados de produção.

## Limite e replanejamento

Uma hipótese concreta por tentativa; até 2 retrabalhos sem nova decomposição. Replanejar se faltar evidência nova. Pontos expressam tamanho relativo, não horas nem limite de qualidade.

## Próxima ação

Revalidar os caminhos e o achado no candidato atual, obter dependências verificadas e reproduzir o caso negativo antes de alterar código.

## Retorno exigido

IMPLEMENTED (nunca DONE pelo builder)

Devolver arquivos alterados, checks realmente executados com resultados, evidências, limitações e riscos residuais. Revisão independente, integração e reteste pelo lead são condições separadas; não alterar status do catálogo nem declarar aceite automático.
