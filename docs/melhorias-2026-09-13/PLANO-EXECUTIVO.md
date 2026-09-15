# Plano executivo — continuidade após auditoria

**Resultado esperado:** corrigir as falhas restantes, completar o atendimento operacional e qualificar um candidato reproduzível para decisão de produção.

Há20 entregas declaradas, mas nenhuma tarefa encerrada como DONE. As provas atuais confirmam avanços em auth, transações, execução assíncrona, budget, privacidade e bootstrap da UI. O risco principal agora está nas fronteiras que os testes existentes não discriminam: evidência falsa, retry/reconciliação, rota legada de dados, recovery de mídia e integração das ações no frontend.

## Prioridades

| Ordem | Entrega | Resultado mensurável |
|---|---|---|
|1 — confiança e contenção | PROD00/01/02/03/07/10/14/16 | Candidato identificado; conhecidos ruins rejeitados; política/escopo e recuperação respeitados |
|2 — fluxo utilizável | PROD17–27, com backend validado | Operador conclui atendimento com mídia, contexto e ações sem UUID manual ou controles inertes |
|3 — consistência e sustentação | PROD04–15/18/28–37 conforme dependências | Concorrência, revogação, a11y, runtime, imagens, observabilidade e recuperação demonstrados |
|4 — qualificação e decisão | PROD38–41 | E2E real, documentos reproduzíveis, crítica independente e pacote de release |
|5 — operação | PROD42/43 | Implantação autorizada, piloto e SLO observado em campo |

P0 ordena risco; P1 continua obrigatório. Preservar os aceites originais e incorporar os32 achados. As correções de contenção independentes de D02/D05 não devem esperar ratificação para impedir bypass ou efeito indevido; ativação e política definitiva dependem do responsável.

## Estratégia de implementação

Manter arquitetura modular, sessões opacas, outbox PostgreSQL e contratos válidos. Reusar as APIs transacionais e componentes já entregues. Cada tarefa inicia pela diferença entre código observado, aceites e prova disponível, sem repetir implementação para satisfazer um rótulo antigo.

A auditoria atualiza os documentos de estado imediatamente. A tarefa39 continua necessária para verificar novamente a documentação contra o futuro candidato final e ensaiar os runbooks.

## Capacidade e cronograma

São44 tarefas de continuidade e281 pontos relativos estimados. Essa revisão substitui a estimativa anterior para o trabalho restante; a diferença de pontos não mede produtividade ou conclusão. Calibrar por duas entregas verticais aceitas e prever prazo por velocidade observada, incluindo crítica, integração e reexecução. Dependências externas e janela mensal de SLO ficam visíveis separadamente.

Quando autorizado, usar até quatro agentes: integrador, dois executores com fronteiras independentes e um crítico com contexto novo. Papéis de produto, dados e operação precisam de pessoas designadas. Schema, auth, API composition, worker, Inbox/Admin, manifests e CI são recursos coordenados por dono único.

## Governança e risco

O backlog é a fonte de status; evidência de cada execução é vinculada a fonte/lock/imagem/run. Defeitos e ausência de prova bloqueiam o aceite correspondente. Decisões D01–D06 abertas bloqueiam apenas a parte dependente, com recomendação concreta e dono.

Não aceitar nova release por média, nota, quantidade de testes ou status de job. Todos os gatesG01–G12 exigem prova coerente; falhas High obrigatórias precisam ser resolvidas. O pacote41 antecede a autorização de implantação. Produção42 e observação43 não podem ser declaradas por simulação.

## Saídas e responsáveis

- Integrador: candidato, contratos, DAG, integração e rastreabilidade.
- Backend: autorização, durabilidade, mídia, IA, dados e APIs operacionais.
- Frontend: fluxos completos, contexto, estados, responsividade e acessibilidade.
- Plataforma/QA: gates, isolamento, imagens, CI, observabilidade, carga e DR.
- Crítico independente: rejeição de aceites insuficientes e revisão final.
- Donos externos: decisões de produto/dados, ambiente, release e operação.

A primeira ação é PROD00: congelar o candidato atual sem perder trabalho preexistente. As demais seguem as dependências dos cartões, sem esperar infraestrutura que não é necessária à sua prova.
