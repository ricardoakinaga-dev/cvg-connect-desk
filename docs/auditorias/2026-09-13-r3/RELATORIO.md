# Auditoria de resultados — R3, 13/09/2026

**Veredito do produto: NOT_READY.** Há avanços confirmados, mas o candidato atual falha ao iniciar o realtime pelo comando nativo. Esta rodada audita e planeja; não implementa correções nem autoriza publicação.

Candidato: HEAD `754f9badac46278e77d21de91c58eedb15e80581` + worktree preexistente; [inventário de 820 arquivos](evidencias/sources-before.json), [git status](evidencias/git-status.txt), [barra congelada](evidencias/quality-bar.json). Execuções em 13/09, horários dos logs UTC/local America/Sao_Paulo conforme ferramenta. Hashes, e não apenas HEAD, identificam o código auditado.

## Resultado executivo

A proteção Bearer de `/metrics` funciona nos testes HTTP: em produção, token ausente na configuração retorna503; credencial ausente/incorreta401; Bearer correto200. Compose e Prometheus transmitem o token e `compose config` passa. **Isso fecha o controle do handler e a configuração estática, não o gap de observabilidade operacional.** Scrape/alerta real e inicialização do processo continuam obrigatórios.

A nova importação `import { metrics } from '@cvg/shared'` em `apps/realtime-service/src/index.ts:20` quebra a fronteira ESM/CommonJS. O subprocesso de PROD-05 encerrou com `SyntaxError: The requested module '@cvg/shared' does not provide an export named 'metrics'`; o hook falhou e os17 testes não executaram. Uma segunda execução CLI mínima repetiu o erro antes de I/O. Node24.20.0; Dockerfile usa esse comando, mas nenhuma imagem foi iniciada nesta rodada. [Prova nativa](evidencias/realtime-native-boot.log), [metadados](evidencias/realtime-native-boot.json), [PROD-05](evidencias/integration-05/output.log).

O 17/17 informado pelo usuário é um resultado recebido anterior; não é o resultado do candidato na revalidação atual. Os87 testes realtime e AAA-05 isolado14/14 passam porque o carregamento ocorre sob Vitest. Não há contradição entre o handler testado e o entrypoint quebrado: são fronteiras diferentes.

## Evolução dos achados

Dos32 achados R2: **5 RESOLVED, 6 PARTIAL, 21 OPEN**. Foram acrescentados **5 novos High**, totalizando37 registros de rastreabilidade;26 OPEN,6 PARTIAL e5 RESOLVED. Não é uma nota de prontidão nem percentual de programa concluído. DOC01 está PARTIAL: documentação central corrigida aqui, disciplina de atualização da execução ainda pendente.

- Resolvidos no escopo específico: BE-A02 (retry com assinatura renovada), BE-A03 (ACK2xx de recibo completed), OPS01 (digest divergente), OPS02 (contradição comando/exit/log), OPS04 (evento desconhecido).
- Parciais: BE-A01 (unknown preservado, mas recovery órfão não fechado), BE-A04 (recovery conectado e SCAN_FAILED incluído, ainda com risco de contenção), OPS03 (queries vazias recusadas, outros inválidos passam), OPS06 (identidade de imagem ponta a ponta), OPS07 (baseline42/42 atual, selagem abrangente pendente), DOC01.
- Permanecem abertos: privacidade legada, CAS opcional, smoke/DR e todos FE01–17. 82/82 fontes frontend comparáveis à R2 estão idênticas; isso não significa que todo o repositório esteja inalterado.

| Novo achado | Consequência | Evidência e limite | Execução |
|---|---|---|---|
| R3-RT01 | Realtime não inicia; bloqueia PROD-05 atual | Processo nativo reproduzido; Docker não executado | PROD-44,05,34,36 |
| R3-BE01 | Invocação Secretary órfã em processing pode receber ACK sem retomada | Caminho conectado e teste mock; SIGKILL/PG real pendente | PROD-10,12,13 |
| R3-BE02 | Lote de recovery pode ocupar o pool com locks que aguardam novas conexões | Função real+pool simulado; timeout real limita espera, não deadlock infinito | PROD-14,32 |
| R3-OP01 | Gate aprova query com números nulos, acima do budget ou medição futura | Probe local no validador real | PROD-02,33 |
| R3-OP02 | Artefato derivado recebe PASS sem runId/attempt | Probe local no validador real | PROD-02,03,40 |

[ACHADOS.json](ACHADOS.json) contém avaliação atual, origem, fontes, limites e tarefas. Os títulos dos achados R2 são identificadores históricos: leia `current_review` para o estado atual. Relatórios especialistas: [backend](evidencias/backend/findings.json), [operações](evidencias/ops/report.md), [frontend](evidencias/frontend/RELATORIO-R3.md).

## Evidência de interface

Frontend real servido em Vite próprio, com API e usuário sintéticos e WebSocket deliberadamente fechado. Reproduzidos: Inbox com viewport1024 e documento1318, foco em drawer fechado; rascunho perdido em Inbox→Tarefas→Inbox; busca sem request ao servidor. Capturas também documentam anexo como chip, transferência desabilitada, formulários/vínculos/admin incompletos. O banner de reconexão da fixture não é novo defeito de produto. [Observações](evidencias/frontend/focused-observations.json) e [captura1024](evidencias/frontend/inbox-1024-selected.png).

## Verificações atuais

| Escopo | Estado | Resultado | Limite |
|---|---|---|---|
| Typecheck | PASS | [33/33 pacotes](evidencias/typecheck.log) | Sem cache; não comprova inicialização. |
| Lint | PASS | [33/33 pacotes](evidencias/lint.log) | Warnings dentro dos limites. |
| Web unit/jsdom | PASS | [268/268;22 arquivos](evidencias/web-unit.log) | Sem backend real. |
| PROD-02/03/36 | PASS | [25+17+5=47/47](evidencias/ops/node-tests.log) | Não cobre os novos adversariais; PROD36 não prova Docker. |
| Realtime unit | PASS | [87/87;10 arquivos](evidencias/realtime-unit.log) | AAA05 executado separadamente; Vitest não prova bootstrap nativo. |
| Realtime metrics HTTP | PASS | [3/3](evidencias/ops/realtime-health.log) | Está incluído nos87; não somar. Handler em servidor HTTP local sob Vitest. |
| AAA-05 isolado | PASS | [14/14](evidencias/aaa05/results.json) | PG/Redis próprios+sockets reais; classe carregada pelo Vitest, não entrypoint CLI. |
| PROD-05 atual | FAIL | [1 suite falhou;17 testes não executados](evidencias/integration-05/output.log) | Falha de bootstrap realtime no beforeAll; não são17 falhas de asserção. |
| Bootstrap realtime nativo | FAIL | [exit1](evidencias/realtime-native-boot.log) | Erro de named export antes de I/O; não atribuir ao PG. |
| PROD-18 atual | PASS | [18/18](evidencias/integration-18/output.log) | PG/Redis isolados; precondições omitidas no cliente ainda não protegidas. |
| Backend focado | PASS | [38/38;5 arquivos](evidencias/backend/unit-tests.log) | Mocks; nome postgres em suíte não significa PG real. |
| Gate adversarial R3 | FAIL_REQUIREMENT | [4 cenários inválidos aceitos; controle vazio rejeitado](evidencias/ops/query-probe.log) | null, excedente, futuro e run/attempt ausentes; fixtures no validador real. |
| Recovery pool probe | FAIL_REQUIREMENT | [1 job progride;10/50 não progridem na janela simulada](evidencias/backend/pool-probe.json) | Função real extraída+pool simulado; não alegar deadlock infinito/PG medido. |
| Compose config | PASS | [2/2 arquivos](evidencias/compose-config.json) | Somente parsing/interpolação; não Docker up ou scrape. |
| PROD-00 baseline hashes | PASS_STATIC | [42/42 sem drift](evidencias/ops/baseline-drift.json) | Recalculo de hashes; não reexecução dos8testes. |
| PROD-00 suite | SUBMITTED_NOT_RERUN | 8/8 informado | Suite grava diretório histórico fixo; não executada nesta auditoria para preservá-lo. |
| Browser UI parcial | PARTIAL | [23 PNGs;Inbox375/1024/1440 e páginas desktop](evidencias/frontend/RELATORIO-R3.md) | Vite real com API sintética; não E2E integrado; não16rotas×5viewports. |
| git diff --check | PASS | [exit0](evidencias/diff-check.log) | Não substitui validação dos arquivos novos não rastreados. |
| Docker/MinIO/ClamAV/SIGKILL/E2E real/DR/carga/CI remoto | NOT_RUN | Sem prova nesta rodada | Também sem build global/coverage atual/sandbox oficial/scrape real. Não inferir indisponibilidade do ambiente, apenas não executado. |


Não somar execuções sobrepostas como testes únicos. PROD-05 anterior e PROD-00 informado são evidências recebidas; falhas atuais nunca são substituídas pelo histórico. Fixtures e runners estão arquivados para inspeção, mas caminhos/portas/runId temporários precisam ser regenerados para nova execução.

## Escopo, preservação e independência

Foram usados scouts de backend, frontend e operações com contexto novo e propriedade somente de artefatos temporários; o integrador inspecionou fontes, logs, captura e reproduziu o bootstrap separadamente. PostgreSQL/Redis de testes receberam nomes/portas próprios e teardown dos recursos do run. Nenhum banco preexistente ou serviço de produção foi alvo. Nenhum commit, deploy ou limpeza do worktree foi feito. Apenas documentação final foi alterada; o inventário pós-auditoria valida preservação das820 fontes monitoradas, com escopo explícito.

A crítica final do **relatório e plano** está em [VALIDACAO](VALIDACAO.md); não equivale à revisão independente do produto integrado prevista em PROD-40. Docker/Compose real, MinIO/scanner real, SIGKILL físico, E2E com stack real, políticas D01–D06, imagens/CI/carga/DR e certificação final permanecem pendentes. Infraestrutura não exercitada é NOT_RUN; não se presume que esteja indisponível.

## Nova rodada

[Plano executivo](../../melhorias-2026-09-13-r3/PLANO-EXECUTIVO.md), [roadmap](../../melhorias-2026-09-13-r3/ROADMAP.md) e [backlog](../../melhorias-2026-09-13-r3/BACKLOG.md): preservar PROD-00–43 e acrescentar PROD-44 para restaurar o bootstrap antes de PROD-05. As45 tarefas começam PLANNED nesta rodada; observações atuais reconhecem entregas e não significam45 tarefas a reimplementar. As55 exigências originais e37 registros de achados têm rastreabilidade explícita.

## Integridade histórica observada

Os manifestos das auditorias inicial e R2 conferem48/48 e111/111 entradas. O manifesto do plano R2 confere55/56: `evidencias/VALIDACAO.md` diverge do hash histórico recebido. Esse arquivo não foi editado nesta rodada e o manifesto antigo não foi refeito para ocultar a divergência. [Recalculo](evidencias/historical-manifests.json). Para linhagem R3, BACKLOG.json e contratos recebidos foram preservados por snapshot e hash próprio.
