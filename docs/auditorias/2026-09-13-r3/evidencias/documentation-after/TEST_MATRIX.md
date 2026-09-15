# Matriz de testes — auditoria R3, 13/09/2026

PASS refere-se ao check e candidato identificados, não ao aceite integral da área. Resultados antigos estão preservados nos snapshots. **PROD-05 atual falhou no bootstrap; não repetir17/17 recebido como validação atual.**

| Escopo | Estado | Resultado | Evidência / limite |
|---|---|---|---|
| Typecheck | PASS | 33/33 pacotes | [evidência](auditorias/2026-09-13-r3/evidencias/typecheck.log) — Sem cache; não comprova inicialização. |
| Lint | PASS | 33/33 pacotes | [evidência](auditorias/2026-09-13-r3/evidencias/lint.log) — Warnings dentro dos limites. |
| Web unit/jsdom | PASS | 268/268;22 arquivos | [evidência](auditorias/2026-09-13-r3/evidencias/web-unit.log) — Sem backend real. |
| PROD-02/03/36 | PASS | 25+17+5=47/47 | [evidência](auditorias/2026-09-13-r3/evidencias/ops/node-tests.log) — Não cobre os novos adversariais; PROD36 não prova Docker. |
| Realtime unit | PASS | 87/87;10 arquivos | [evidência](auditorias/2026-09-13-r3/evidencias/realtime-unit.log) — AAA05 executado separadamente; Vitest não prova bootstrap nativo. |
| Realtime metrics HTTP | PASS | 3/3 | [evidência](auditorias/2026-09-13-r3/evidencias/ops/realtime-health.log) — Está incluído nos87; não somar. Handler em servidor HTTP local sob Vitest. |
| AAA-05 isolado | PASS | 14/14 | [evidência](auditorias/2026-09-13-r3/evidencias/aaa05/results.json) — PG/Redis próprios+sockets reais; classe carregada pelo Vitest, não entrypoint CLI. |
| PROD-05 atual | FAIL | 1 suite falhou;17 testes não executados | [evidência](auditorias/2026-09-13-r3/evidencias/integration-05/output.log) — Falha de bootstrap realtime no beforeAll; não são17 falhas de asserção. |
| Bootstrap realtime nativo | FAIL | exit1 | [evidência](auditorias/2026-09-13-r3/evidencias/realtime-native-boot.log) — Erro de named export antes de I/O; não atribuir ao PG. |
| PROD-18 atual | PASS | 18/18 | [evidência](auditorias/2026-09-13-r3/evidencias/integration-18/output.log) — PG/Redis isolados; precondições omitidas no cliente ainda não protegidas. |
| Backend focado | PASS | 38/38;5 arquivos | [evidência](auditorias/2026-09-13-r3/evidencias/backend/unit-tests.log) — Mocks; nome postgres em suíte não significa PG real. |
| Gate adversarial R3 | FAIL_REQUIREMENT | 4 cenários inválidos aceitos; controle vazio rejeitado | [evidência](auditorias/2026-09-13-r3/evidencias/ops/query-probe.log) — null, excedente, futuro e run/attempt ausentes; fixtures no validador real. |
| Recovery pool probe | FAIL_REQUIREMENT | 1 job progride;10/50 não progridem na janela simulada | [evidência](auditorias/2026-09-13-r3/evidencias/backend/pool-probe.json) — Função real extraída+pool simulado; não alegar deadlock infinito/PG medido. |
| Compose config | PASS | 2/2 arquivos | [evidência](auditorias/2026-09-13-r3/evidencias/compose-config.json) — Somente parsing/interpolação; não Docker up ou scrape. |
| PROD-00 baseline hashes | PASS_STATIC | 42/42 sem drift | [evidência](auditorias/2026-09-13-r3/evidencias/ops/baseline-drift.json) — Recalculo de hashes; não reexecução dos8testes. |
| PROD-00 suite | SUBMITTED_NOT_RERUN | 8/8 informado | Suite grava diretório histórico fixo; não executada nesta auditoria para preservá-lo. |
| Browser UI parcial | PARTIAL | 23 PNGs;Inbox375/1024/1440 e páginas desktop | [evidência](auditorias/2026-09-13-r3/evidencias/frontend/RELATORIO-R3.md) — Vite real com API sintética; não E2E integrado; não16rotas×5viewports. |
| git diff --check | PASS | exit0 | [evidência](auditorias/2026-09-13-r3/evidencias/diff-check.log) — Não substitui validação dos arquivos novos não rastreados. |
| Docker/MinIO/ClamAV/SIGKILL/E2E real/DR/carga/CI remoto | NOT_RUN | Sem prova nesta rodada | Também sem build global/coverage atual/sandbox oficial/scrape real. Não inferir indisponibilidade do ambiente, apenas não executado. |


Não somar os3 testes de realtime-health aos87 da suíte: são sobrepostos. AAA0514/14 usa PG/Redis/sockets reais sob Vitest; não substitui processo CLI. Não há coverage global/build integral/CI remoto novo medido aqui. [Comandos e limites](auditorias/2026-09-13-r3/VERIFICACOES.json), [relatório](auditorias/2026-09-13-r3/RELATORIO.md) e [G01–G12](melhorias-2026-09-13-r3/CRITERIOS.md).
