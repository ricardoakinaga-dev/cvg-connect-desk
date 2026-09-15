# Instruções para o agente — revisão R3

Esta é uma entrega de auditoria e planejamento. Quando houver solicitação para implementar, use este programa como ponto de partida e preserve o histórico anterior.

## Início

1. Leia AGENTS.md aplicáveis, README, relatório de entregas, BACKLOG.json, CONTRATOS, DECISOES e CRITERIOS. Use engineering-framework e as skills das frentes; delegue apenas quando autorizado e houver tarefa independente verificável.
2. Execute `python3 docs/melhorias-2026-09-13-r3/plan.py validate`. Esse check só valida o plano.
3. Comece PROD00: capture HEAD+diff+fontes/lock/imagens, preserve alterações locais e compare com a sentinela da auditoria. Não faça reset/clean nem reinicie a implementação a partir de HEAD.
4. Leia origin/current_observation/audit_findings do cartão antes de editar. Reproduza o negativo, preserve controles já implementados e classifique o trabalho em reparo, complemento ou prova.

## Execução e atualização

BACKLOG.json é a fonte de status. Use PLANNED→READY→RUNNING→IMPLEMENTED→REVIEW→VERIFIED→DONE; REWORK/BLOCKED exigem causa e próxima ação. DONE requer todos os aceites, integração e revisão, com evidência atual. Não transponha20 entregas antigas para20 tarefas DONE.

`python3 docs/melhorias-2026-09-13-r3/plan.py render` atualiza cartões/índices. Registrar resultados em evidencias e apontar os arquivos em evidence_refs. A observação da auditoria é baseline histórica, não status de execução. Atualize a narrativa e decisões com data; preserve evidências de falhas.

Os comandos checks são pontos de entrada propostos. Inspecione o runner/teste antes de rodar. Configure URL do banco isolado ANTES de importar módulos com singleton. Use CVG_PROGRAM_DIR e CVG_RUNTIME_DIR próprios para não sobrescrever os relatos anteriores. Não rode DR com nomes fixos ou teardown sem marcador.

Unitários não substituem PG, processos, provider, scanner, browser ou operador exigidos. Ambiente ausente bloqueia o aceite dependente; não impede inventário, implementação de contenção ou testes puros independentes. Registre NOT_RUN/BLOCKED, nunca skip/PASS.

## Coordenação

Até quatro slots quando houver autorização: integrador, dois executores e crítico fresco. Briefs delimitam arquivos, recursos, contratos, aceites, testes e retorno. Sem descendentes por padrão. Um dono serializa schema/migrations, auth, app composition, worker, Inbox/Admin, API client, manifests e CI. Worktrees não isolam bancos/providers ou numeração de migration.

Um executor devolve delta, evidência, limites e risco; não aprova sua própria entrega. O crítico fresco julga o artefato e os negativos. Findings voltam ao dono e exigem prova corrigida; não flexibilize gate/threshold para obter verde.

## Autoridade e encerramento

Decisões D01–D06 continuam abertas até evidência de resposta do responsável. Corrigir bypass e preparar alternativas pode avançar; ações dependentes de definição de produto/dados/ativação aguardam a definição correspondente. Uma flag não representa aprovação humana.

Ao atingir PROD40, produzir crítica independente do candidato integrado. PROD41 prepara fontes, digests, scans, migrações, backup/restore, runbooks, operadores e abort/rollback. Pedir eventual autorização apenas sobre o pacote concreto. Não implantar nem enviar mensagens externas sem autorização aplicável. PROD43 exige observação real do período acordado.

Relatório final: tarefas aceitas, defeitos pendentes, comandos realmente executados, links de evidência, identidade do candidato, crítica independente e condição concreta para o próximo passo. Não alegar prontidão com gates obrigatórios ausentes.

## Complemento obrigatório R3

Ler a auditoria R3 antes de executar. Há45 cartões, incluindo PROD-44 antes de PROD-05. Preservar os5 achados resolvidos; títulos históricos não são defeitos atuais. Verificar current_observation/current_review e os aceites originais mais complementos R3.

Parametrizar runners que escrevem no histórico antes de usá-los; provas novas pertencem a esta rodada com runId/attempt próprios. Não executar automaticamente comandos antigos com nomes fixos, nem db:types que altere produto sem revisão. Teste de bootstrap deve iniciar CLI/subprocesso e não apenas importar classe via Vitest. Mocks não substituem Docker/PG/MinIO/scanner/provider/SIGKILL/E2E real.

Manter BACKLOG.json atualizado com cada transição e regenerar cartões. Observações da auditoria não são PASS da execução futura. Crítica documental desta rodada não conclui PROD-40. Sem commit/deploy/limpeza automáticos; seguir a autorização efetiva da sessão de implementação.
