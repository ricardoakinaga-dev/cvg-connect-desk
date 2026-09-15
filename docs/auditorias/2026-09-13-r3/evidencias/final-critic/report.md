# Crítica independente documental R3

**Pacote: REVIEW_PASS. Produto: NOT_READY.** Uma revisão material, sem editar produto/documentos e sem delegação. Uma verificação focada do delta corretivo do integrador fechou o único blocker; não é PROD-40 nem certificação operacional.

## Bloqueador encontrado e corrigido

R3-DOC-C01 (High): os aceites PROD-05-R3-AC1 e PROD-34-R3-AC1 em BACKLOG.json exigem imagem final com mesmo digest avaliado, embora PROD-36 dependa de05 e PROD-35 dependa de34/36. O roadmap diz corretamente que imagem é posterior. Remover esse requisito dos aceites iniciais e mantê-lo nas tarefas35/36. Detalhes e condição objetiva de fechamento em findings.json. O DAG sintático não detecta essa inversão semântica.

## Verificações e achados sustentados

- `python3 docs/melhorias-2026-09-13-r3/plan.py validate`: exit0;45 tarefas,284 pontos,55 exigências,DAG acíclico. As tarefas têm aceites, recuperação, ownership e observações atuais; PLANNED descreve a execução futura. Controles resolvidos explicitamente preservados.
- ACHADOS.json:32 R2 =5 RESOLVED+6 PARTIAL+21 OPEN;5 R3 OPEN;37 total =26 OPEN+6 PARTIAL+5 RESOLVED. Títulos antigos identificados como históricos com current_review.
- Bootstrap CLI reproduzido independentemente com NODE_ENV=test e DATABASE_URL inválida loopback1: exit1 e SyntaxError de export metrics em index.ts:20 antes de I/O. Prova própria native-boot.log/json.
- Logs realtime-unit e aaa05/aaa05.log sustentam87/87 e14/14 respectivamente. integration-05/output.log mostra beforeAll falho e17 skipped, descritos corretamente como17 não executados, não17 falhas de asserção. Matriz e documentos centrais preservam as diferenças entre classe Vitest, processo nativo e imagem Docker não exercitada.
- ops/query-probe.log sustenta quatro inválidos aceitos e controle vazio recusado; backend/pool-probe.json mostra pool simulado sem progresso10/50, não prova deadlock infinito nem PG real. O relatório preserva esses limites.
- Relatório, verificações, arquitetura, matriz, gaps, threat model, certificação e00-meta apontam para R3/NOT_READY. Provas recebidas, executadas, parciais e NOT_RUN estão separadas, sem somar testes sobrepostos.
- D01–D06 possuem donos funcionais, propostas e fronteiras de bloqueio; G01–G12 e tarefas40–43 separam qualificação, crítica independente, pacote/autorização e observação pós-deploy. Recuperação é definida em todos os cartões e provas de restore/rollback operacionais ficam explícitas nos aceites próprios.
- Comandos históricos ainda aparecem como pontos de entrada a adaptar; AGENTE/README e precondições proíbem execução automática e exigem parâmetros/diretórios próprios. Não os executei. Não houve PROD00, Docker, produção, reset, cleanup nem suite que escreva histórico.
- Nenhum link relativo quebrado encontrado no Markdown principal R3 inspecionado. Manifestos finais em geração não foram usados como blocker; selagem final deve ser verificada pelo integrador.

## Limites

Revisão documental com inspeção de evidências decisivas e dois comandos independentes seguros. Não reexecutei toda a suíte, auditoria frontend ou probes de banco. Não constitui aprovação de todos os caminhos do produto. O fechamento do blocker requer correção verificável pelo integrador; não ampliar o escopo para implementar o produto nesta solicitação.

## Verificação focada do delta final

O integrador corrigiu os aceites canônicos e regenerou os cartões. Inspecionei05/34/36:05 explicitamente não espera imagem;34 prova regressão por subprocesso sem esperar35/36;36 constrói/inicia imagem candidata e fornece digest à etapa35 posterior. `plan.py validate` passou novamente45/55. R3-DOC-C01 RESOLVED. Nenhum blocker documental remanescente observado. Manifestos finais continuam sujeitos à selagem/verificação pelo integrador.
