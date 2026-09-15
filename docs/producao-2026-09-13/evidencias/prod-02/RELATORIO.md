# PROD-02 — evidências de execução

Candidato base: `754f9badac46278e77d21de91c58eedb15e80581` + worktree (auditoria 13/09).
SHA-256 dos arquivos antes da correção: ver `identity-before.txt`.

## Reprodução antes (auditoria)

| Adversarial | Comando | Resultado antes |
|---|---|---|
| WRONG-SHA + `queries:{}` gera PASS | `node docs/auditorias/2026-09-13/evidencias/ops-master-adversarial.mjs` | `STALE + EMPTY evidence { dr-e2e: PASS, staging-otel: PASS, query-performance: PASS }` (`repro-before-master-adversarial.txt`) |
| FAIL externo gera VERIFIED_CANDIDATE exit 0 | idem | `all local PASS + external FAIL: VERIFIED_CANDIDATE exit: 0` (idem) |
| CERTIFIED sem verificação de tag | `node docs/producao-2026-09-13/evidencias/prod-02/repro-certified-without-tag.mjs` | `FINAL=TRIPLE_AAA_CERTIFIED`, `tag/signature check presente: false`, `emitido só por status local: true` (`repro-certified-without-tag.txt`) |

## Correção

- `scripts/production/evidence-gate.mjs` (novo): manifesto por check, vínculo ao candidato (commit/lock/source/image), JSON estrito, conjunto de queries não vazio, PASS com log e hash, estados FAIL/BLOCKED/NOT_RUN/SKIPPED/INVALID/MISSING, política de certificação explícita (nunca CERTIFIED local).
- `scripts/triple-aaa-verify.mjs`: CLI `--run`/`--evaluate` gera e avalia manifestos reais; remove percentuais fixos de coverage (métricas medidas); exit 0 só com `VERIFIED_CANDIDATE`.

## Resultado depois

| Prova | Comando | Exit |
|---|---|---|
| Suíte PROD-02 (17 casos) | `node --test scripts/production/prod-02.test.mjs` | 0 (`testes-depois.txt`) |
| Gate real sem selo (estado inequívoco) | `node scripts/triple-aaa-verify.mjs --evaluate --artifacts-dir /tmp/prod02-smoke2` | 1, `FINAL: FAILED`, todos REQUIRED=`MISSING` (`gate-sem-selo.txt`) |

Cobrem: SHA/lock/source/image divergentes, STALE, JSON vazio/truncado, query set vazio, PASS narrativo, FAIL/BLOCKED/NOT_RUN/SKIPPED, gate ausente, FAIL externo com flag, payload externo sem vínculo, coverage medido (77.7/66.6/55.5/44.4 — não 94.6 fixo), selo local nunca CERTIFIED.

## Não comprovado

- Execução do pipeline completo (`--run` sem `--checks-file`) no repo: não executado (25 min+ de checks pesados); a lógica foi exercitada pelo CLI real com checks reais em tmp.
- Execução real no GitHub Actions.
- Artefatos DR/staging/query-performance reais: produtores externos ainda não emitem vínculo de candidato; o gate agora rejeita a ausência.

## Pós-revisão independente (lote M0) — correções M1/M2/L2

Ver `RELATORIO-CORRECOES.md`: source hash passou a cobrir untracked (excluindo
evidências do repo), artefato/externo derivado passou a exigir identidade
lock/source e janela de horário (STALE no derivado) e os defaults de banco
exigem run isolado `cvg_aaa_*` (nunca 5432/connect_desk_db). Suíte passou de 17
para 22 testes. L5 (`EVENT` inválido → `push`) permanece aberto em PROD-03, fora
do escopo de escrita.
