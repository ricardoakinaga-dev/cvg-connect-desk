# Decisões de produto, dados e operação

**Versão:** D-1 · **Data:** 14/09/2026 · **Dono:** lead do programa com o usuário/autoridades nominais.
O usuário solicitou este programa completo de melhorias. Esta entrega produz o planejamento. As decisões históricas D01–D06 não são presumidas como aprovadas; SA-001 conferiu e **nenhuma autorização posterior foi localizada** (registro em `EXECUCAO.md`). Uma autorização já concedida não deve ser solicitada novamente.

**Status atual de todas as decisões: OPEN (não aprovadas).** Silêncio, tempo decorrido, existência de arquivo ou status de backlog não são aprovação.

**Revalidação SA-002-R3-A1:** 15/09/2026 · candidato `754f9badac46278e77d21de91c58eedb15e80581+worktree#product-4ee19f2ec5ca8bff` · contrato relacionado `C-1`. D01–D06 continuam OPEN; a tabela abaixo delimita preparo permitido, mas não substitui autoridade nem registra aprovação.

**Não há pergunta bloqueando a entrega do plano.** As propostas abaixo permitem preparar e executar verificações locais quando a implementação for iniciada; apenas a ação efetivamente dependente aguarda a decisão correspondente. A coluna “Preparo permitido sem a decisão” delimita exatamente o trabalho que **não** pode ficar parado.

| ID | Proposta concreta | Alternativa e consequência | Impacto se aprovada | Subações afetadas (bloqueadas até decidir) | Preparo permitido sem a decisão | Quem decide | Limite real |
|---|---|---|---|---|---|---|---|
| D01 — acesso | Manter permissões efetivas no banco; ação+recurso; visão gerencial global apenas por capacidade explícita e projeção de campos mínimos | Catálogo fixo reduz editabilidade; escopo global implícito enfraquece isolamento. Ratificar matriz por papel e diretório | Habilita fechar B03/B04 (≥95) e a parte global dos KPIs (B14/A08); muda o que cada papel enxerga | Aplicação de política global nova (SA-013/044); projeções gerenciais em SA-022/046 | DTO, negativos, correções da política vigente e testes sintéticos | Responsável de produto + segurança, nomes a registrar | Mudança de política global/produção em SA-013/044 |
| D02 — dados | Ratificar finalidade/retenção/exportação/eliminação por cópia, backup e subprocessador; usar políticas existentes como proposta documentada | Retenção indefinida ou apagamento amplo altera risco/obrigação; não tratar simples flag como eliminação total | Habilita fechar B21/B22 e C07/SA-031/SA-055 com política explícita | Eliminação/liberação de dados **reais** (SA-031/SA-055) | Inventário, dry-run, fixtures, mecanismos reversíveis e restore de cópia de ensaio | Responsável pelos dados + operação | Eliminação/liberação de dados reais em SA-031/055 |
| D03 — relações | Implementar N:N compatível tutor–paciente, conforme alvo vigente: vínculo explícito, backfill idempotente e API/UI coerentes | Manter 1:N exige alteração formal do requisito e reavaliação; não encerra automaticamente a meta original | Habilita fechar B13 e SA-021/042; muda schema e contratos de paciente | Migração de cardinalidade e contratos (SA-021/042) | Inventário/proposta SA-020, backfill em ensaio isolado e correções independentes | Produto + dados | Alteração de cardinalidade/schema/contrato em SA-021/042 |
| D04 — Kanban | Concluir navegação, status e filtros contratados; customização nova de colunas recebe escopo separado | Ampliar agora requer modelo, UX e migração adicionais, sem estimativa implícita | Define se colunas customizadas entram no escopo; não afeta a correção A02/A03 | Expansão ambígua de colunas (SA-040, se proposta) | Correção de reabertura, movimento, concorrência e acessibilidade (SA-005/040) | Produto | Somente expansão ambígua em SA-040 |
| D05 — ferramentas IA | Manter deny-default; aprovar uma allowlist nominal com limites, aprovadores e ações; construir workflow com flag desligada | Manter todas desligadas é estado seguro, mas não prova ferramenta habilitada. Nova exclusão de requisito exige decisão explícita | Habilita fechar B20 e SA-030/044 com uma ferramenta real habilitada | Habilitação/efeitos externos (SA-030/044) | Budget, validação, approval/replay, deny-default e testes sintéticos | Produto + segurança | Habilitação/efeitos de SA-030/044 |
| D06 — implantação | Candidato por digest, staging isolado, TLS, escala, custo, janela, piloto, plantão, abort/rollback e estabilização definidos no pacote SA-060 | Promover sem piloto/provas não satisfaz o programa | Habilita SA-061 e a observação de SA-062 | Implantação, efeitos externos e custos (SA-061/062) | Pacote, ensaio local, runbook, digests e rollback documentado | Operador responsável + autoridade de release | Implantação SA-061 e efeitos/custos externos |

## Registro de fechamento

Para cada decisão: ID, status, autoridade nominal, data, escopo, versão de contrato, candidato quando pertinente, evidência da instrução e restrições. Uma tarefa de inventário pode terminar enquanto a decisão continua OPEN; a tarefa de implementação dependente permanece parcial/bloqueada até ter a informação necessária.

Não usar silêncio, tempo decorrido, existência de arquivo ou status de um backlog como aprovação. Não pedir aprovação de decisões rotineiras de código, tarefas reversíveis já autorizadas ou novamente de instruções vigentes.

## Recursos externos

Homologação de Gateway/Secretary, envio de mensagens de teste, registry, domínio/TLS e armazenamento durável precisam de ambiente e autoridade efetivos. Preparar scripts, fixtures e pacote primeiro. Na falta de credenciais, avançar no trabalho independente e registrar precisamente qual prova externa falta; não substituir provedor real por mock no gate de integração.
