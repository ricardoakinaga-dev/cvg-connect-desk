# AAA-06 — Corrigir endereço de realtime na implantação web

> Gerado de BACKLOG.json por plan.py; não editar manualmente.

SIMULAÇÃO: todas as tarefas permanecem PLANNED. Cada lote é apenas uma sugestão condicionada à evidência, revisão e integração dos predecessores. Não lança agentes/serviços, não executa checks e não concede aceite.

Status: PLANNED | Responsável: frontend/infra | Fase: 1 | Risco: R2 | Pontos: 3

## Objetivo

Imagem padrão usa origem pública correta, /ws e ws/wss conforme protocolo.

## Contexto e dependências

Achados: A05
Áreas: 8, 15
Predecessores: AAA-01
Contratos: C02, C08
Exclusividade do repositório: não
Locks de recursos: compose-topology, isolated-db:AAA-06, ports:AAA-06

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

- apps/desk-web/Dockerfile
- apps/desk-web/nginx.conf
- apps/desk-web/src/lib/realtime.ts
- apps/desk-web/src/__tests__/realtime.test.ts
- docker-compose.yml
- e2e/smoke/aaa-06-remote.spec.ts

## Escrita proibida

- docs/auditorias/2026-09-12
- .gauntlet
- .gauntlet-v2-archive-20260912
- docs/execucao-aaa-2026-09-12/BACKLOG.json

## Critérios de aceitação

- Imagem padrão usa origem pública correta, /ws e ws/wss conforme protocolo.
- Navegador remoto em HTTPS conecta sem localhost nem mixed content; reconnect mantém fluxo.
- Override explícito funciona em dev; tokens nunca aparecem em URL/log do fluxo novo.

## Evidência e revisão

- diff e commit base/candidato + SHA-256 dos arquivos relevantes
- comandos executados, exit code e logs sanitizados; testes novos identificados
- reprodução negativa antes/depois e regressão da fronteira afetada
- review independente sem histórico e verificação de integridade antes/depois
- manifesto da evidência ligado ao contrato vigente; integração e reteste pelo lead

## Checks declarados (não executados por esta ferramenta)

EXISTING significa declarado existente; revalidar disponibilidade no candidato. TO_CREATE exige criar o check antes de executá-lo e registrar a evidência. Nenhuma declaração equivale a check aprovado.

### Existentes

- `pnpm --filter @cvg/desk-web exec vitest run src/__tests__/realtime.test.ts` — ambiente: local

### A criar

- `pnpm exec playwright test e2e/smoke/aaa-06-remote.spec.ts` — ambiente: isolated

## Rollback

Trabalhar em branch/worktree isolada; preservar baseline e diff. Reverter apenas commits próprios ainda não integrados. Para mudança de schema, entregar procedimento expand/contract e roll-forward testado; nunca apagar dados de produção.

## Limite e replanejamento

Uma hipótese concreta por tentativa; até 2 retrabalhos sem nova decomposição. Replanejar se faltar evidência nova. Pontos expressam tamanho relativo, não horas nem limite de qualidade.

## Próxima ação

Revalidar os caminhos e o achado no candidato atual, obter dependências verificadas e reproduzir o caso negativo antes de alterar código.

## Retorno exigido

IMPLEMENTED (nunca DONE pelo builder)

Devolver arquivos alterados, checks realmente executados com resultados, evidências, limitações e riscos residuais. Revisão independente, integração e reteste pelo lead são condições separadas; não alterar status do catálogo nem declarar aceite automático.
