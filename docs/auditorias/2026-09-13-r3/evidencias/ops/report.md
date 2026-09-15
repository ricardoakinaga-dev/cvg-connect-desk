# R3 — OPS, métricas e evidências

Revisão read-only do candidato `754f9badac46278e77d21de91c58eedb15e80581`, worktree com alterações. Critérios congelados: `docs/melhorias-2026-09-13/CRITERIOS.md`. Artefatos desta lane em `/tmp/cvg-audit-r3-dvlqz0my/ops`.

**Resultado: houve correções reais, mas o escopo ainda não qualifica produção.** PROD02 25/25 + PROD03 17/17 + PROD36 5/5 = 47/47; realtime-health 3/3 passou pelo servidor HTTP real em loopback. O `/metrics` bloqueia sem token em produção, rejeita anônimo/token incorreto e aceita Bearer configurado. Compose/Prometheus estão conectados estaticamente; scrape real não foi observado.

| Anterior | R3 | Evidência e limite |
|---|---|---|
| OPS01 | RESOLVED | Drift compara agora imageDigest live e selado; regressão CLI executada rejeita troca exclusiva do digest. Referências: scripts/triple-aaa-verify.mjs:159, scripts/production/prod-02.test.mjs:445, node-tests.log: OPS01 — reavaliação com imageDigest diferente reprova o candidato PASS. Limite: Resolução do bypass do CLI; não prova identidade da imagem efetivamente entregue (OPS06). |
| OPS02 | RESOLVED | Reprodução original de manifesto de comando contraditório é rejeitada: comando/escopo, exit, conteúdo de log, futuro e metadados validados; coverage exige denominadores e tabela. Referências: scripts/production/evidence-gate.mjs:330, scripts/production/evidence-gate.mjs:741, scripts/production/prod-02.test.mjs:410, scripts/production/prod-02.test.mjs:455, node-tests.log. Limite: Resolução limitada ao manifesto de comando original. Via derivada de artefatos tem lacuna nova R3-OP02; não comprova coverage global real. |
| OPS03 | PARTIAL | [{}] agora INVALID e 11 identidades são exigidas. Porém medições null, acima do orçamento e em 2099 ainda PASS no default evaluateCheck; detalhado R3-OP01. Referências: scripts/production/evidence-gate.mjs:496, scripts/production/evidence-gate.mjs:528, scripts/production/evidence-gate.mjs:970, query-probe.log. Limite: Probe usa payload sintético e função real; nenhuma medição SQL/DB executada. |
| OPS04 | RESOLVED | main preserva evento solicitado; política desconhecida produz FAILED. Regressores de typo e main foram executados. Referências: .github/scripts/certification-aggregator.mjs:217, .github/scripts/certification-aggregator.mjs:484, scripts/production/prod-03.test.mjs:379, node-tests.log. Limite: Política local comprovada; rulesets/checks required remotos não consultados. |
| OPS05 | OPEN | DeleteObjectCommand continua sem import; referência falha após put/get. HEAD de objeto apagado não trata 404 e condição mantém || true. Referências: scripts/staging-smoke.mjs:11, scripts/staging-smoke.mjs:42, scripts/staging-smoke.mjs:43. Limite: CURRENT_STATIC, não se contatou S3/ClamAV/collector. Não duplicar como novo achado. |
| OPS06 | PARTIAL | Manifesto ganhou source/lock/run/attempt/tempo e validação correspondente; permanece digest docker inspect .Id de build efêmero separado, sem prova de registry manifest ou igualdade boot/scan/E2E/entrega. Referências: .github/workflows/triple-aaa-gate.yml:214, .github/workflows/triple-aaa-gate.yml:233, .github/scripts/certification-aggregator.mjs:164, .github/scripts/certification-aggregator.mjs:186. Limite: CURRENT_STATIC. Nenhum Docker build/push/boot ou CI remoto executado. |
| OPS07 | PARTIAL | Baseline atual PROD00: 42/42 fileHashes correspondem aos arquivos presentes, zero drift (não repetir seis divergências antigas). PROD36 ainda commit string/resultado narrativo sem source/lock/digests/hashes de artefato e horários completos por run. Referências: docs/producao-2026-09-13/evidencias/prod-00/baseline/candidate-manifest.json:1, baseline-drift.json, docs/producao-2026-09-13/evidencias/prod-36/prod-36-evidence.json:1. Limite: Não rodado PROD00 por escrita no repo; verificação estática de hashes não equivale a novo selo integrado nem qualifica todos os 481 paths de status Git. |
| OPS08 | OPEN | Bancos src/dst fixos são apagados sem ownership; backup /tmp, integridade de fixture só grep tag, sem igualdade outbox/DLQ; pg-restore permite ausência de checksum. Referências: infra/scripts/dr-e2e.sh:12, infra/scripts/dr-e2e.sh:30, infra/scripts/dr-e2e.sh:117, infra/scripts/dr-e2e.sh:135, infra/scripts/pg-restore.sh:16. Limite: CURRENT_STATIC, script destrutivo deliberadamente não executado. RPO/RTO e restore mídia/erasures não observados. |

## Novos achados

### R3-OP01 — Query gate aceita medições nulas ou acima do orçamento e datas futuras (High)

node /tmp/cvg-audit-r3-dvlqz0my/ops/query-probe.mjs. Usa DEFAULT_CHECKS query-performance, 11 nomes obrigatórios e identidade coincidente. Cenários null-measurements, over-budget, future-measurements retornam PASS/reasons=[]. Controle [{}] retorna INVALID.

Gate pode aprovar alegação de performance sem números reais ou com números explicitamente fora do limite.

Prova: scripts/production/evidence-gate.mjs:528, scripts/production/evidence-gate.mjs:530, scripts/production/evidence-gate.mjs:532, /tmp/cvg-audit-r3-dvlqz0my/ops/query-probe.log.

Tarefas: PROD-02, PROD-33. Correção para revalidação: Exigir tipos number finitos, linhas inteiras, identidade/SQL/plano, janela temporal, orçamento congelado e calcular aderência do número ao orçamento; negativos isolados para null, string vazia, excedente e futuro.

Limite: Fixture sintética exercita validador real; não significa produtor atual gera nulos ou que banco real excede orçamento.

### R3-OP02 — Artefato derivado dispensa runId/attempt exigidos pelo contrato de evidência (High)

Cenário missing-run-metadata remove runId/attempt do payload, preservando 11 queries numéricas válidas, identidade e data atual; evaluateCheck retorna PASS sem manifesto separado.

Manifesto de comando reprova ambiente sem run/attempt, mas mesma obrigação C10 é contornada para artefato derivado, impedindo atribuição confiável ao run/attempt.

Prova: scripts/production/evidence-gate.mjs:441, scripts/production/evidence-gate.mjs:551, scripts/production/evidence-gate.mjs:570, scripts/production/evidence-gate.mjs:690, /tmp/cvg-audit-r3-dvlqz0my/ops/query-probe.log.

Tarefas: PROD-02, PROD-03, PROD-40. Correção para revalidação: Validar run/attempt e vínculo esperado tanto no payload quanto no manifesto derivado; preservar metadados e exigir mesma semântica de identidade/tempo em todas vias.

Limite: Não é repetição de command=true/exit99/log vazio, que está corrigido. Probe local, sem falsificar prova externa.

## Limites e próximo passo

Não executados: PROD00 (escreve evidência no repo), bancos, Docker/compose config/up, CI remoto, S3/ClamAV/collector, scans, carga, DR, restore, deploy. A suite realtime completa/AAA05 não foi repetida; só health, porque o lead cobre regressão mais ampla. Não houve implementação.

Corrigir R3-OP01/02 em PROD02/33 e concluir OPS05/06/07/08 com responsáveis já atribuídos. Revalidar contraprovas locais, depois obter evidência da infraestrutura real e de um único candidato final.

Artefatos: `findings.json`, `node-tests.log`, `realtime-health.log`, `query-probe.mjs`, `query-probe.log`, `baseline-drift.json`, `source-hashes.json`, `source-lines.log`.
