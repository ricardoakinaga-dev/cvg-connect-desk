# Auditoria independente de operações / CI — 2026-09-13

Escopo read-only no checkout atual. Não rodei migrations, builds, DR destrutivo nem serviços. Escritas exclusivamente em /tmp/cvg-audit-20260913. Critério congelado: obrigação documental → código atual → prova executada, sem compensar gates obrigatórios por média. Notas 0 ausente, 25 esqueleto, 50 parcial, 75 substancial com lacunas, 90 implementado/testado com limitação, 100 comprovado em perfil representativo. As notas abaixo são da aderência operacional por subtema, não certificação nem notas de todo o produto. Skills engineering-framework e gauntlet-loop lidos/aplicados em modo audit.

## Itens avaliados

| Item / obrigação | Nota | Evidência atual | Lacuna / confiança |
|---|---:|---|---|
| 1. Gate mestre rejeita evidência antiga/adulterada (AAA-26) | 25 | scripts/triple-aaa-verify.mjs:87,112,136,140 | Reproduzido: WRONG-SHA + queries vazio gera PASS; externo FAIL gera VERIFIED_CANDIDATE exit 0. CERTIFIED emitido sem verificar tag. Alta. |
| 2. Agregador cross-workflow por SHA (AAA-26) | 50 | .github/scripts/certification-aggregator.mjs:24,89,130 | 29 testes oficiais verdes; adversarial Docker e gate global falhos + staging ausente ainda VERIFIED_CANDIDATE. `migrations-upgrade` é o mesmo job fresh. Dependency-review obrigatório mas só executa em PR: push main produz skip/FAIL. Alta. |
| 3. CI macro e regressões de segurança (AAA-16/26, docs 56/57) | 65 | .github/workflows/ci.yml:232; package.json:13 | Jobs reais lint/types/tests/build/PG/Redis/audit/Docker/SBOM, agregado fail-closed. Porém exclui explicitamente 11 arquivos de regressões AAA críticas; comentários remetem a runs anteriores do líder, sem execução CI no SHA atual. Alta em configuração; execução remota não provada. |
| 4. Supply chain/dependências (AAA-15) | 80 | package.json:28 e overrides; .github/workflows/security.yml:43,51; docs/security/AAA-15-triagem-dependencias-2026-09-13.md:61 | Auditoria high/prod, pins actions, exceções com owner/expiry. Trivy só API e ignore-unfixed=true; não prova todas imagens entregues e scan/smoke não usam mesmo digest. Audits atuais a cargo do líder. Alta código, média prova global. |
| 5. Smoke browser reproduzível (docs 39/42/45–49) | 65 | playwright.config.ts:11,32; .github/workflows/smoke-e2e.yml:38,80; e2e/support/start-e2e-stack.ts | Suite/stack dedicada implementadas; config reutiliza servidor já existente; workflow procura reports/traces em diretórios diferentes do output padrão do config (`reporter:list`, sem outputDir). Rodagem remota e Browser atual não comprovadas nesta lane. Média. |
| 6. Isolamento de testes (AAA-00) | 75 | e2e/support/aaa/isolated-env.ts; playwright.aaa.config.ts; package.json:19 | Harness AAA dedicado existe. Smoke teardown usa fuser -k em portas fixas; DR usa nomes fixos e DROP DATABASE sem marcador; isolamento ainda não universal. Alta. |
| 7. Cobertura/qualidade de testes (docs25, TEST_MATRIX) | 55 | docs/25-plano-testes-completo.md:246; packages/shared/vitest.config.ts:10; scripts/triple-aaa-verify.mjs:51 | Shared tem thresholds executáveis 85/80/85/85, mas docs exigem core90/domain80/API70/web60/overall75; gate mede só shared e escreve percentuais históricos fixos no detail. Ausência de prova global atual. Alta. |
| 8. Backup/restore representativo (AAA-24, DR) | 45 | infra/scripts/pg-backup.sh:18; pg-restore.sh:18; dr-e2e.sh:12,130; dr-e2e-node.mjs:29,79,180,195 | Backup custom/checksum/retenção e ensaio presentes. Node usa SELECT→objeto em memória→INSERT de 11 tabelas, não backup durable/COPY; sessions/acks sem fixtures, checksum nunca verificado, readiness false ainda PASS. Shell compara apenas ocorrência de tag no JSON; checksum ausente no restore permite prosseguir. Sem retenção/corrupção/privacidade pós-restore comprovadas. Alta. |
| 9. Deploy/containers (PRODUCTION_DEPLOYMENT) | 70 | docker-compose.yml:69,91,105,246; apps/message-worker/Dockerfile:48 | Rede/ports locais/read_only/caps, scanner real, métricas protegidas concretos. Compose prod não passa OTEL_* aos runtimes apesar de docs instruírem setá-las; imagens serviços latest/stable sem digest; nenhum ensaio de rollback atual nesta lane. Alta configuração, média execução. |
| 10. Verificador production-readiness | 40 | scripts/production-readiness.mjs:6,15,45 | Reproduzido READY exit0 sem NODE_ENV, JWT_SECRET e INTERNAL_EVENTS_SECRET; também não exige scanner real. Não é hard gate completo da configuração de boot. Alta. |
| 11. Health / operabilidade do worker | 65 | apps/desk-api/src/app.ts:432,458,502; apps/message-worker/src/health.ts:10; healthcheck.ts:15 | API checa PG+migrations+Redis de forma substantiva; worker /health responde ok incondicional e Docker probe só SELECT1 em processo novo, não progresso/fila/loop. Realtime nc só porta. Alta. |
| 12. Logs/métricas operacionais (docs66–70/OBSERVABILITY) | 75 | apps/message-worker/src/index.ts:182,204,259; apps/desk-api/src/app.ts:218; infra/prometheus/prometheus.yml:9 | Logs com correlação/spans e scrape token implementados, /metrics fail-closed. Sem prova end-to-end de alertas/runtime work-progress e Prometheus só scrape API/realtime. Fonte real existe; não apenas scaffolding. Alta implementação; execução atual a validar. |
| 13. Tracing real (AAA-25/OBSERVABILITY) | 50 | scripts/otel-e2e-check.mjs:24,46,54,75; apps/message-worker/src/index.ts:313 | SDK instrumentado nos runtimes existe, mas verificador troca endpoint fornecido por HTTP receptor próprio, cria span sintético e busca strings no body; não sobe API/worker/realtime nem prova pipeline Collector/Tempo real. Doc chama Collector REAL indevidamente. Alta. |
| 14. Staging MinIO/ClamAV | 45 | scripts/staging-smoke.mjs:11,34,42,43; .github/workflows/staging-integrations.yml:110 | Verificador chama DeleteObjectCommand sem import e depois usa `... !== 200 || true`, além de HEAD 404 cair no catch. Integrações reais possuem testes condicionais; prova não é exigida pelo aggregador. Configuração service command suspeita de schema não usada como achado confirmado (actionlint ausente). Alta bug JS, média integração. |
| 15. SLO/carga/dashboards/alertas (AAA-25) | 25 | docs/SLO.md:7,10,12,32; e2e/load/smoke-load.js:14,29; infra/scripts/query-performance.mjs:86; infra/grafana/dashboards/README.md:1 | SLO aritmética errada: 28800s*.001=28.8s, webhook 30 dias .0005=21.6min (não13). Dedup bem-sucedida confundida com efeito duplicado. Dashboard só README; nenhum rules/alertmanager no Prometheus. K6 30s/10VUs não perfil10k/100k/100sessões/10+30min×3, nenhum realtime/browser vital; EXPLAIN aceita seqscan caro sem índice e não falha processo. Alta. |
| 16. Reconciliação documental e certificação final (AAA-27/28) | 35 | docs/TRIPLE_AAA_CERTIFICATION.md:19,27,77; docs/TEST_MATRIX.md:40; docs/21-instalacao-local.md:28; package.json:23 | Certificação cita SHA/738 testes históricos e diz nenhum blocker de código; há blockers reproduzidos. TEST_MATRIX afirma VERIFIED sem vínculo atual; setup diz scripts root DB placeholders embora implementados. DR doc declara ensaio executado e restore não testado, confundindo dois scripts. Atualização histórica ainda não reconciliada. Alta. |

AAA-29/30/31: tarefas e critérios lidos; testes aaa-29/30/31.test.tsx existem no fonte, mas score visual/funcional pertence à lane frontend para evitar dupla avaliação. Não reutilizar status PLANNED das tasks geradas como prova de ausência de implementação.

## Achados por severidade

P1 — Falso candidato liberável: scripts/triple-aaa-verify.mjs:87/136 aceita evidência incompatível e status externo FAIL. Prova executada por trechos de fonte exatos via vm, sem executar instalação/build/migrations. Arquivo ops-master-adversarial.txt.

P1 — Agregador omite gates necessários: .github/scripts/certification-aggregator.mjs:24; prova fixtures com Docker/global FAIL e staging ausente ainda candidate em ops-aggregator-adversarial.txt. Casos atuais do projeto (29) passam, logo suíte não detecta a lacuna.

P1 — Certificação DR/OTel superestima teste: dr-e2e-node.mjs:180 readiness false não reprova; scripts/otel-e2e-check.mjs:46 simula receptor externo. Script existente não permite concluir requisito AAA-24/25 satisfeito.

P1 — Regressões AAA críticas fora CI atual: package.json:13 exclui authz/isolation/atomicity/privacy/etc e CI não as repõe em ambientes marcados do candidato.

P2 — Production-readiness dá READY para configuração incompleta (ausentes NODE_ENV/JWT_SECRET/INTERNAL_EVENTS_SECRET), comprovado em ops-readiness-without-jwt-node-env.txt.

P2 — Staging smoke tem ReferenceError determinístico no happy path S3 (DeleteObjectCommand não importado) e assertion de delete tautológica; scripts/staging-smoke.mjs:42.

P2 — Sem dashboards/alertas operacionais e SLO/metodologia não implementados: infra/grafana/dashboards contém só README, infra/prometheus contém apenas scrape config, docs/SLO.md:32 matematicamente inconsistente.

P2 — Runbook de restore/desastre não garante fluxo documentado: scripts PG nomeiam bancos sem marcador; restore aceita checksum ausente; ensaio não testa corrupção/retenção/reaplicação privacidade.

## Execuções atuais e limites

- node .github/scripts/certification-aggregator.test.mjs: exit0, 29 passed, 0 failed (ops-aggregator-tests.txt).
- Teste adversarial importa evaluateRequired real, reaproveita fixtures e acrescenta casos negativos: reproduções detalhadas em ops-aggregator-adversarial.mjs/.txt.
- Extração de trechos exatos do gate mestre para vm com dados sintéticos: WRONG-SHA + queries vazio PASS; externo FAIL→VERIFIED_CANDIDATE exit0. ops-master-adversarial.mjs/.txt. Uma tentativa inicial do harness teve syntax error e foi corrigida em /tmp; nunca mudou fonte.
- production-readiness real em subprocess com ambiente sanitizado: READY exit0, segredos obrigatórios ausentes. Nenhum segredo real lido/logado.
- Não executei CI remoto, Docker, k6, DR, browser, bancos ou scans. Builds/tests de produto estão sendo cobertos pelo líder e outras lanes. Não extrapolar findings estáticos para incidentes observados.

## Documentos lidos

Integralmente: docs/SLO.md, RUNBOOK.md, DISASTER_RECOVERY.md, PRODUCTION_DEPLOYMENT.md, OBSERVABILITY.md, TRIPLE_AAA_CERTIFICATION.md, SECURITY_VULNERABILITY_TRIAGE.md, TEST_MATRIX.md; tasks AAA-00/15/16/24/25/26/27/28/29/30/31 (ênfase critérios). Leitura dirigida de títulos, requisitos e critérios de aceite: docs14–19,21,25 e todos docs38–70; detalhados trechos governança docs66–70, cobertura docs25, e triagem docs/security/AAA-15-triagem-dependencias-2026-09-13.md. Snapshot/before-snapshot não usado como evidência.

Veredito da lane: NOT_VERIFIED para liberação, com gates obrigatórios falhando em adversariais atuais. Não há fundamento para ≥90 em operações/CI/DR/SLO ou declaração de produção pronta. Próximo trabalho concreto: corrigir e adversarialmente validar o gate de evidências antes de usar seus relatórios como aceite.

## Complemento docs72/73/74 (documentos de alvo; nenhuma instrução executada)

Leitura dirigida dos requisitos: docs/72-prompt-modernizacao-triplo-aaa.md:101 (garantias críticas mecanicamente testáveis), :922 (SLOs), :995 (security), :1255 (thresholds exemplificativos 85/80/85/85 e críticos90 se viável), :1327 (restore), :1553 (certificação); docs/73-prompt-certificacao-final-triple-aaa.md:495 (restore só conta provado), :628 (nenhum HIGH runtime/reachable sem mitigação), :925 (master gate), :974/:989/:1014 (AAA1/2/3), :1198 (honestidade); docs/74-prompt-release-certification-closure.md:164–258 (todos required gates, ausência != VERIFIED), :405–432 (Collector REAL + transação webhook→API→DB→outbox→worker→gateway/Secretary→realtime com correlação), :1014–1017 (FAILED/CONDITIONAL/VERIFIED_CANDIDATE/CERTIFIED), :1031 (separar PR/release/scheduled).

Esses requisitos sustentam particularmente notas1/2/8/13/16. A reprodução vm é um teste unitário adversarial dos trechos atuais do verificador, NÃO execução da CLI mestre completa; a prova do agregador importa função real com fixtures, NÃO execução remota de workflow. production-readiness foi executado como CLI real. Média numérica dos subitens não é aceite: requisitos obrigatórios1/2 falham, DR/OTel representativos não comprovados; estado operacional permanece NOT_VERIFIED, candidato NÃO aprovado.
