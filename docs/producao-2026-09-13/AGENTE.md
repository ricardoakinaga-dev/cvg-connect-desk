# Instruções de execução para o agente

> Histórico de planejamento/execução. Estado atual e próximas ações: [auditoria das entregas](../auditorias/2026-09-13-entregas/RELATORIO.md) e [programa R2](../melhorias-2026-09-13/README.md). Requisitos preservados; status e provas abaixo têm o contexto original.

Copie como solicitação de implementação quando desejar iniciar:

> Execute o programa em docs/producao-2026-09-13, começando por PROD-00. Leia README, critérios, contratos, decisões e backlog; preserve o worktree. Implemente e verifique até qualificar o candidato, respeitando dependências e recursos compartilhados. Use subagentes em tarefas independentes com ownership explícito e crítico fresco. Prepare o pacote de release; implantação depende de autorização válida para esse pacote.

## Primeira sessão

1. Ler AGENTS.md aplicáveis e skills invocadas. Conferir `git status` e arquivos reais; a auditoria inclui mudanças não commitadas. Não resetar, limpar ou substituir código pelo HEAD.
2. Executar `python3 docs/producao-2026-09-13/plan.py validate`. Isso verifica o plano, não o produto.
3. Abrir PROD-00 e criar snapshot/candidato, ambiente isolado e inventário de disponibilidade. Registrar reproduções atuais; não presumir que achados de13/09 continuam idênticos.
4. Atualizar o backlog canônico e regenerar cartões. Registrar decisões/contratos e a próxima ação verificável. Ao iniciar trabalho substancial, manter o plano vivo e controle de execução conforme engineering-framework; não reutilizar estado antigo de outra iniciativa.

## Contrato de cada tarefa

Antes de editar, verificar predecessores DONE, requisitos, decisões necessárias, arquivos reais e recursos. Os caminhos em ownership são fronteiras de trabalho a confirmar; nomes de testes TO_CREATE são propostas. Descobrir configuração e reutilizar suítes adequadas: não criar um teste espelho ou um runner artificial só para cumprir o nome sugerido.

O executor devolve: problema reproduzido, delta, arquivos, aceites com prova, comandos/resultado, ambiente/identidade, riscos, rollback e próxima ação. Testes locais, integração real, inspeção visual e decisões humanas devem ser identificados separadamente. Não registrar um exit0 como prova de um requisito que o comando não exerceu.

O integrador fecha DONE somente com todos os aceites, evidência atual e revisão. Crítico fresco lê o artefato, negativos e limites sem aceitar o relato do builder como prova. Regressão vai para REWORK e exige novo aceite; indisponibilidade vira BLOCKED com causa, dono e condição de retomada. Nenhuma tarefa termina só porque acabou o orçamento.

## Paralelismo e recuperação

Até quatro slots: integrador, dois builders e um crítico, sem descendentes por padrão. Não executar escritores simultâneos em paths sobrepostos ou locks comuns. Schema/migrations, auth, composição API, worker, clientes compartilhados, Inbox/Admin, manifests e CI precisam de dono de integração. Worktrees isolam arquivos, não recursos externos.

Cada run usa namespaces sintéticos marcados. Teardown remove apenas recursos próprios. Migrations aplicadas são imutáveis; preferir expand/contract e roll-forward comprovado. Nunca testar destrutivamente no banco existente ou apagar alterações de outro executor. Persistir estado e evidência a cada entrega para retomada.

## Encerramento

PROD-40 qualifica o candidato; PROD-41 prepara pacote concreto e registra a decisão. PROD-42 depende da autorização aplicável, não de silêncio, nota ou passagem de tempo. PROD-43 mantém evidência de campo separada da de laboratório. O planejamento atual não concede autorização de implantação nem envio de mensagens externas.
