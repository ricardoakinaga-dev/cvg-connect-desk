# PROD-03 — evidências de execução

Candidato base: `754f9badac46278e77d21de91c58eedb15e80581` + worktree (auditoria 13/09).

## Reprodução antes (auditoria, `certification-aggregator.before.mjs`)

Comando: `node docs/auditorias/2026-09-13/evidencias/ops-aggregator-adversarial.mjs`

- `ADVERSARIAL Docker+aggregate failed, staging absent: VERIFIED_CANDIDATE` (`repro-before-aggregator-adversarial.txt`)
- `PUSH dependency-review skips per workflow: FAILED` (idem — push impossível)
- Suíte oficial antiga: `29 passed, 0 failed` sem cobrir os negativos (`repro-before-official-tests.txt`)

## Correção

- `.github/scripts/certification-aggregator.mjs`: inventário por escopo (Docker/boot, imagem, staging real, coverage shared/global, migrations fresh/upgrade distintos, E2E, DR, carga, segurança, agregados); políticas por evento (`pull_request`/`push`/`schedule`/`release`); consulta paginada; SHA por run; imagem por artefato de digest; rejeição de sucesso antigo, cancelamento, duplicado, renomeado, skip e payload malformado; waivers explícitos com substituto; gates pendentes com dono (PROD-34 cobertura global, PROD-33 carga) bloqueando release.
- `.github/workflows/triple-aaa-gate.yml`: jobs novos `migration-upgrade (previous -> current)` e `image-identity (build + digest)`; `promotion-state` depende de todos e falha em qualquer dependente vermelho.
- `.github/workflows/triple-aaa-certification.yml`: agregação por evento, checkout da branch default (nunca código de PR), `workflow_dispatch` para release, falha quando o estado não é `VERIFIED_CANDIDATE` (PR informativo).
- `.github/scripts/certification-aggregator.test.mjs`: 51 casos.

## Resultado depois

| Prova | Comando | Exit |
|---|---|---|
| Reprodução dos adversariais (mesma fixture) | `node docs/producao-2026-09-13/evidencias/prod-03/repro-after-adversarial.mjs` | 0 — `Docker+aggregate+staging: FAILED`; `PUSH dependency-review skip: VERIFIED_CANDIDATE (WAIVED_WITH_SUBSTITUTE)`; `RELEASE sem coverage-global/load: BLOCKED (2 blockers)` (`repro-after-adversarial.txt`) |
| Suíte PROD-03 (16 casos) | `node --test scripts/production/prod-03.test.mjs` | 0 (`testes-depois.txt`) |
| Suíte do agregador (51 casos) | `node .github/scripts/certification-aggregator.test.mjs` | 0 (`testes-agregador-depois.txt`) |
| Parsers YAML (actionlint ausente) | PyYAML 6.0.1, `yaml-validation.txt` | 0 — todos os workflows parseiam |
| Job `migration-upgrade` real (extraído do YAML) | `DATABASE_URL_ADMIN=… pnpm --filter @cvg/database exec tsx .prod03-migration-upgrade.check.ts` | 0 — `upgrade ok: 23 -> 24`, banco sintético dropado (`migration-upgrade-local.txt`) |

## Não comprovado

- Execução real no GitHub Actions (sem `gh`, sem rede e sem runner): paginação/artefato de imagem exercitados por fixtures fiéis da API.
- Inspeção de rulesets/branch protection remotos: `branchProtection.inspected=false` com motivo; a configuração de required checks por evento é a política local testada, não a settings remota.
- `coverage-global` (PROD-34) e `load` (PROD-33) permanecem pendentes com dono e bloqueiam release explicitamente.
- `image-identity` roda build Docker real apenas no CI (Docker local indisponível por permissão no socket).
