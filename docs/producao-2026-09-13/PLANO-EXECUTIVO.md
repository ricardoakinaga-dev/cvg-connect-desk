# Plano executivo

> Histórico de planejamento/execução. Estado atual e próximas ações: [auditoria das entregas](../auditorias/2026-09-13-entregas/RELATORIO.md) e [programa R2](../melhorias-2026-09-13/README.md). Requisitos preservados; status e provas abaixo têm o contexto original.

**Objetivo:** tornar o atendimento utilizável de ponta a ponta e produzir evidência confiável de segurança, durabilidade, capacidade e recuperação antes de promover um candidato a produção.

A auditoria encontrou implementação substancial em sessões, outbox, envio e domínio. Os impedimentos principais são autorização incompleta por ação/recurso, retry de webhook, efeitos de worker, ingresso de mídia, contexto operacional da interface e gates que podem aceitar evidência insuficiente. Testes locais positivos e telas renderizadas com mocks não encerram esses riscos.

## Prioridades e resultado de negócio

| Prioridade | Trabalho | Resultado exigido |
|---|---|---|
| P0 | PROD-02/03/04/07/08/09/14 | Gate rejeita candidato inválido; acesso indevido bloqueado; evento aceito recuperável; efeitos sem duplicação; mídia insegura indisponível |
| P1 — produto | Demais tarefas de M1 e M2 | Operador conclui atendimento com contexto, mídia, tarefas, notas, alertas e administração autorizada |
| P1 — sustentação | M3 e M4 | CI real, imagens rastreáveis, readiness, observabilidade, carga e restauração comprovadas |
| Release e operação | M5–M7 | Pacote revisável, decisão identificada, implantação controlada e observação de campo |

P1 continua obrigatório para o escopo aprovado. P0 ordena risco, não permite dispensar os demais requisitos. Uma decisão de escopo só altera requisito com aprovação explícita e atualização rastreável; N:N tutor–paciente e ferramentas IA não desaparecem por serem trabalhos maiores.

## Escopo e estratégia

Corrigir sobre a arquitetura modular atual, sessões opacas e outbox PostgreSQL. Preservar contratos válidos e provar o que já existe. Não há justificativa neste plano para troca de stack, microserviços adicionais ou reescrita geral. Recursos de produto, backfill e acessos externos dependem dos contratos e decisões registrados; o agente pode avançar nas frentes independentes.

O programa tem 44 tarefas e 330 pontos relativos. A implementação deve dividir cartões grandes em subtarefas com os mesmos aceites e dono, sem fragmentar a prova integrada. Planejar até quatro agentes simultâneos quando autorizados: integrador, dois executores em arquivos independentes e um crítico fresco. Donos funcionais são papéis a atribuir, não pessoas já comprometidas. Operação, produto e responsável pelos dados fornecem as decisões externas correspondentes.

## Controle e prazo

Usar dependências do backlog, além de exclusão por arquivos e recursos compartilhados. Schema/migrations, composição da API, auth, worker, Inbox/Admin e workflows exigem coordenação. O integrador mantém a baseline, numera migrations, integra e fecha tarefas com evidência atual. A revisão independente inspeciona o artefato real e devolve falhas ao dono.

Não fixar calendário sem medir capacidade. Após as duas primeiras entregas verticais, calcular previsão por pontos restantes / velocidade observada, incluindo revisão, reexecuções e disponibilidade dos ambientes. Atualizar a previsão a cada marco. Os pontos não incorporam espera por autorização, credenciais ou janela mensal de SLO.

## Condições para aprovar o candidato

Todos os critérios G01–G12 devem ter prova atual do mesmo candidato e não pode haver falha obrigatória, evidência ausente ou risco crítico/alto sem resolução conforme política. A cobertura dos 55 itens será reavaliada individualmente; média ou selo não substitui os critérios. A entrada em produção exige ainda pacote de release e autorização correspondente; a disponibilidade mensal só poderá ser comprovada em campo.

## Riscos e mitigação

| Risco | Controle / dono |
|---|---|
| Worktree com alterações anteriores | Snapshot e comparação antes de editar; integrador PROD-00 |
| Perda ou duplicação em falhas | Transações, recibos recuperáveis e testes com crash; backend PROD-07–12 |
| Drift de contrato entre UI e API | C01–C10, integração por fluxo e negativos; lead PROD-01/18/38 |
| Aceite falso por mock, skip ou evidência antiga | Gate adversarial e identificação do candidato; QA PROD-02/03/34/40 |
| Operação sem capacidade de recuperar | Restore real, monitoramento e segundo operador; SRE PROD-36/37/41 |
| Política ou acesso externo ausente | Decisão com dono e bloqueio apenas do aceite dependente; DECISOES.md |

O resultado final é um sistema implantado e observado sob os contratos acordados. A entrega atual é o planejamento para chegar a esse resultado.
