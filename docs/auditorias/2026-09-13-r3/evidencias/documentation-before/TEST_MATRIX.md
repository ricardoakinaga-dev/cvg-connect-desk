# Matriz de testes — auditoria de entregas13/09/2026

Resultados abaixo pertencem ao candidato auditado identificado por hashes. PASS é do check listado, não de toda a área ou da prontidão produtiva. Contagens anteriores foram preservadas no snapshot documental da auditoria.

| Escopo atual | Resultado | Evidência / limite |
|---|---|---|
| Typecheck | PASS33/33 pacotes | [log](auditorias/2026-09-13-entregas/evidencias/typecheck.log) |
| Lint | PASS33/33, warnings dentro dos limites | [log](auditorias/2026-09-13-entregas/evidencias/lint.log) |
| Web unit/jsdom | PASS268/268,22 arquivos | [log](auditorias/2026-09-13-entregas/evidencias/web-unit.log); sem API real |
| Gates/runtime, suítes existentes | PASS94/94 | [log](auditorias/2026-09-13-entregas/evidencias/ops/unit-tests.log) |
| Auth + worker, frente backend | PASS29/29 | [relatório](auditorias/2026-09-13-entregas/evidencias/backend/report.md) |
| Secretary async PROD10 | PASS7/7 | [log](auditorias/2026-09-13-entregas/evidencias/integration-10/output.log); PG/Redis próprios, providers simulados |
| Budget/approval PROD13 | PASS11/11 | [log](auditorias/2026-09-13-entregas/evidencias/integration-13/output.log); PG próprio |
| Nova erasure PROD16 | PASS9/9 | [log](auditorias/2026-09-13-entregas/evidencias/integration-16/output.log); não cobre bypass legado |
| Operações PROD18 | PASS18/18 após corrigir ambiente de invocação | [log](auditorias/2026-09-13-entregas/evidencias/prod18-corrected.log); tentativa inicial INVALID preservada |
| Adversariais novos do gate | FAIL do requisito | [reprodução](auditorias/2026-09-13-entregas/evidencias/lead-gate-repro.log): três casos inválidos aceitos |
| Browser visual/bootstrap | PARTIAL | [capturas e observações](auditorias/2026-09-13-entregas/evidencias/frontend/RELATORIO.md); frontend real, API sintética |
| Build global, coverage completa e CI remoto | NOT_RUN nesta rodada | Não extrapolar tipos/lint ou resultados antigos |
| Provider oficial, storage/scanner representativos, tracing completo | NOT_RUN nesta rodada | Mocks não encerram aceite real |
| Carga, DR durável, matriz a11y completa, produção | NOT_RUN nesta rodada | Metas e procedimentos continuam obrigatórios |

A [auditoria](auditorias/2026-09-13-entregas/RELATORIO.md) registra metodologia, falhas e limites. Os [critérios G01–G12](melhorias-2026-09-13/CRITERIOS.md) definem o fechamento futuro. Não há cobertura global atual medida por esta tabela.
