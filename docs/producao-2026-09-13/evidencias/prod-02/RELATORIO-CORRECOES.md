# PROD-02 — Relatório de correções da revisão independente (lote M0)

Candidato: `754f9badac46278e77d21de91c58eedb15e80581` + worktree (auditoria 13/09).
Escopo de escrita: `scripts/production/evidence-gate.mjs`, `scripts/production/prod-02.test.mjs`,
`scripts/triple-aaa-verify.mjs` (não foi necessário alterar) e evidências em
`docs/producao-2026-09-13/evidencias/prod-02/**`.

Regra mantida: nenhuma assertion foi afrouxada; as correções endurecem o gate e os
novos testes são negativos (rejeitam o caso ruim). Os aceites PROD-02-AC1..AC4 do
cartão permanecem cobertos.

## M1 (ALTO) — `sourceSha256` ignorava arquivos untracked

**Antes:** `listGitTrackedFiles` usava `git ls-files -z` (só índice). Alterar um
arquivo untracked não mudava o hash nem invalidava o selo; o delta real do
candidato (182 untracked no worktree) não era vinculado.

**Correção:**
- `scripts/production/evidence-gate.mjs:107` — `listGitFiles` agora usa
  `git ls-files -z --cached --others --exclude-standard -- . <pathspecs de exclusão>`
  e `computeSourceHash` (`:144`) deduplica (`Set`) e ordena de forma estável,
  hasheando `file\0caminho\0sha256\0`.
- `scripts/production/evidence-gate.mjs:55` — `GIT_EXCLUDE_PATHSPECS` com
  `:(exclude)docs/producao-2026-09-13/evidencias` e
  `:(exclude)docs/execucao-aaa-2026-09-12/runtime`; as mesmas trilhas entram em
  `DEFAULT_SOURCE_EXCLUDES` para o caminho não-git. Assim o hash cobre
  código/configuração de produto (tracked + untracked), mas uma nova evidência
  gerada dentro do repo não invalida o próprio selo a cada run.

**Prova:** `scripts/production/prod-02.test.mjs:450` (repo git temporário:
determinismo; untracked alterado muda o hash; evidências geradas no repo não
mudam) e `:485` (CLI real: selo vincula untracked — alterar untracked em
`--evaluate` gera `candidateDrift=[sourceSha256]` e `FAILED`; escrever nova
evidência no repo não gera drift). Mutação com o código antigo: 2 falhas.

## M2 (MÉDIO) — artefato/externo derivado sem STALE e com lock/source opcionais

**Antes:** payload `{commit, result:"PASS", generatedAt:2000}` e sem
`lockfileSha256`/`sourceSha256` era aceito via manifesto derivado
(`VERIFIED_CANDIDATE`); o caminho derivado não aplicava STALE e o fallback
silencioso herdava lock/source do candidato.

**Correção:**
- `scripts/production/evidence-gate.mjs:322` — `validateArtifactPayload` exige
  identidade C10 (`extractPayloadIdentity`): `commit`, `lockfileSha256` e
  `sourceSha256` obrigatórios e idênticos ao candidato (aceita `candidate.*` e
  atalhos `lock`/`source`), mantendo `imageDigest` quando `check.image`.
- `scripts/production/evidence-gate.mjs:305` — `payloadWindowReasons` valida o
  authored-time (`finishedAt`/`generatedAt`/`startedAt`): ausência/ inválido,
  horário anterior ao selo (STALE) e horário no futuro (>5 min de skew) reprovam.
  Vale para o caminho derivado e para o payload do caminho com manifesto.
- `scripts/production/evidence-gate.mjs:399` — `deriveArtifactManifest` reporta a
  identidade do payload sem fallback silencioso e usa o authored-time validado.

**Prova:** `scripts/production/prod-02.test.mjs:542` (derivado `dr-e2e`: velho com
e sem lock/source e futuro → `INVALID`, nunca PASS) e `:560` (externo derivado
velho/sem identidade → `INVALID`). O caso bom derivado (identidade completa,
pós-selo) segue PASS no fluxo `--run`/`--evaluate`. Mutação com o código antigo:
2 falhas.

## L2 (MÉDIO) — defaults apontavam para `connect_desk_db` na porta 5432

**Antes:** `unit`, `postgres-real` e `migration-check` fixavam
`DATABASE_URL: postgresql://postgres:postgres@localhost:5432/connect_desk_db`,
atingindo banco do host.

**Correção:** `scripts/production/evidence-gate.mjs:707` — `DATABASE_ISOLATION_GUARD`
passou a preceder os três comandos (`:733`, `:740`, `:747`) e nenhum check fixa
`DATABASE_URL`. A guarda exige postgresql com banco `cvg_aaa_<runId>`, porta
dedicada (nunca 5432/padrão) e host local; caso contrário falha com mensagem
inequívoca e exit 78 antes de tocar banco algum.

**Prova:** `scripts/production/prod-02.test.mjs:584` — nenhum default fixa banco;
a guarda real reprova a URL do host e aceita
`postgresql://postgres:postgres@localhost:5433/cvg_aaa_prod02_run1` (só
interpreta a URL, sem conexão).

## L5 (BAIXO, opcional) — `EVENT` inválido cai para `push`

**Não corrigido nesta tarefa:** o fallback está em
`.github/scripts/certification-aggregator.mjs:451`
(`const event = POLICIES[requestedEvent] ? requestedEvent : 'push'`), artefato de
PROD-03 e fora do escopo de escrita autorizado desta correção. Reprodução em
`correcao-repro-antes.txt`/`correcao-repro-depois.txt`
(`EVENT=evento-invalido` → `report.event=push`, sem erro). Encaminhar a correção
para o dono de PROD-03 (falhar explicitamente quando `EVENT` não tiver política).

## Comandos e exit codes (candidato atual)

| Comando | Exit | Log |
|---|---|---|
| `node --test scripts/production/prod-02.test.mjs` (22 testes, 5 novos) | 0 | `correcao-prod-02.test.txt` |
| `node --test scripts/production/prod-03.test.mjs` | 0 | `correcao-prod-03.test.txt` |
| `node .github/scripts/certification-aggregator.test.mjs` | 0 | `correcao-agregador.test.txt` |
| `node docs/producao-2026-09-13/evidencias/prod-02/repro-correcao.mjs` | 0 (5/5 M1/M2/L2) | `correcao-repro-depois.txt` |
| `node scripts/triple-aaa-verify.mjs --evaluate --candidate 754f9ba --artifacts-dir <tmp vazio>` | 1 (`FINAL: FAILED`; 14 REQUIRED=MISSING, 5 externos NOT_EVALUATED) | `correcao-cli-evaluate.txt` |

Nenhum pipeline completo (`--run` sem `--checks-file`) foi executado contra bancos
do host; nenhum processo órfão deixado (checks em tmp, sem servidores iniciados).

## Não comprovado / limites

- Execução real no GitHub Actions e branch protection remotos (sem runner/rede
  `gh`) seguem não comprovados.
- A guarda L2 prova a configuração e o parsing de URL (subprocesso correto), não
  uma suíte real contra um PostgreSQL isolado — isso pertence ao `--run` completo,
  deliberadamente não executado aqui.
- L5 permanece aberto em PROD-03 (fora do escopo).
