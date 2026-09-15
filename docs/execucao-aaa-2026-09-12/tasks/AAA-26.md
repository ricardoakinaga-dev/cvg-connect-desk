# AAA-26 — Executar gates de segurança e evidência CI por SHA

> Gerado de BACKLOG.json por plan.py; não editar manualmente.

SIMULAÇÃO: todas as tarefas permanecem PLANNED. Cada lote é apenas uma sugestão condicionada à evidência, revisão e integração dos predecessores. Não lança agentes/serviços, não executa checks e não concede aceite.

Status: PLANNED | Responsável: release engenharia | Fase: 5 | Risco: R2 | Pontos: 5

## Objetivo

CI completa faz build/lint/typecheck/test/DB/E2E/DR/OTel/carga/scanners em candidato exato.

## Contexto e dependências

Achados: A12, A13, L01
Áreas: 14, 15, 16
Predecessores: AAA-15, AAA-16, AAA-23, AAA-24, AAA-25, AAA-22
Contratos: C08
Exclusividade do repositório: não
Locks de recursos: isolated-db:AAA-26, ports:AAA-26

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

- .github
- scripts/triple-aaa-verify.mjs
- scripts/production-readiness.mjs
- scripts/staging-smoke.mjs

## Escrita proibida

- docs/auditorias/2026-09-12
- .gauntlet
- .gauntlet-v2-archive-20260912
- docs/execucao-aaa-2026-09-12/BACKLOG.json

## Critérios de aceitação

- CI completa faz build/lint/typecheck/test/DB/E2E/DR/OTel/carga/scanners em candidato exato.
- CodeQL/Gitleaks/Trivy/SBOM/dependency-review têm artefatos atuais; não confundir workflow configurado com executado.
- Agregador rejeita ausência, falha, skip obrigatório, SHA divergente e evidência adulterada; caso conhecido ruim é bloqueado.
- Imagem analisada é a mesma que passa smoke; nenhuma tag/deploy/promoção executada sem escopo explícito.

## Evidência e revisão

- diff e commit base/candidato + SHA-256 dos arquivos relevantes
- comandos executados, exit code e logs sanitizados; testes novos identificados
- reprodução negativa antes/depois e regressão da fronteira afetada
- review independente sem histórico e verificação de integridade antes/depois
- manifesto da evidência ligado ao contrato vigente; integração e reteste pelo lead

## Checks declarados (não executados por esta ferramenta)

EXISTING significa declarado existente; revalidar disponibilidade no candidato. TO_CREATE exige criar o check antes de executá-lo e registrar a evidência. Nenhuma declaração equivale a check aprovado.

### Existentes

- `pnpm triple-aaa:verify` — ambiente: isolated
- `pnpm production-readiness` — ambiente: isolated

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
