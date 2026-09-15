**Plano executivo — CVG Connect Desk**

**Resultado pretendido:** elevar o atendimento operacional a um produto seguro, consistente, recuperável, rápido e acessível, com excelência visual específica da CVG. A entrega atual é o plano, roadmap, backlog e instruções executáveis; as correções de software pertencem à execução futura desses cartões.

**Baseline e contexto.** Revisão `754f9badac46278e77d21de91c58eedb15e80581`, relatório [AUDIT-CVG-20260912](../auditorias/2026-09-12/RELATORIO.md), 53/100. Há 33 pacotes, 149 testes existentes aprovados na auditoria, quatro reproduções de defeitos e bloqueios atuais de autenticação, isolamento, build e confiabilidade. Docker local estava inacessível. Números e testes são evidência datada, não prova de que um candidato futuro permaneça igual. AAA-00 os revalida.

Classificação desta entrega: brownfield; atividade de planejamento/especificação; Tier T2 para artefatos documentais e ferramentas de consulta, sem iniciar BUILD do produto. A execução futura atravessa segurança, dados e runtimes e deve adotar Tier T3, contratos e estado durável. O relatório original e os runs `.gauntlet/` existentes são históricos preservados. O run atual encontrado em `.gauntlet/state.json` refere-se a redesign e está FINISHED; o arquivo de arquivo morto não comprova agente em execução.

**Definição de qualidade.** Preservamos a nomenclatura técnica já existente no repositório:

| Eixo | Resultado exigido |
|---|---|
| AAA-1 — Arquitetura e correção | Contratos coerentes, autorização aplicada, transações, lease, idempotência, dados e testes reais |
| AAA-2 — Segurança e confiabilidade | Sessões/isolamento íntegros, mídia controlada, privacidade com escopo verdadeiro, dependências triadas e resistência a falhas |
| AAA-3 — Operação e observabilidade | Imagem reproduzível, CI por SHA, readiness correto, recuperação ensaiada, tracing/métricas/alertas e desempenho medido |
| Excelência visual transversal | Rubrica visual >=95/100, evidência de todas as rotas/estados aplicáveis, crítica independente e ausência de barreiras essenciais |

Meta interna de reauditoria: **média geral >=95/100 e nenhuma das 18 áreas abaixo de 90/100**. Essas notas não substituem gates binários. Qualquer falha obrigatória, evidência ausente ou High/Critical não resolvido impede conclusão AAA. “Triplo AAA” é uma meta interna deste programa, não selo de entidade externa nem conformidade WCAG AAA; o alvo de acessibilidade é WCAG 2.2 AA. Não usar documentos históricos que alegam ausência de blockers para apagar os achados atuais.

**Escopo integral:** fechar A01–A16 e L01; sessões e autorização HTTP/realtime; arquitetura Chat/Gateway; leases e transações; envio/anexos/paginação; types/lint/build/CI/dependências; privacidade/autoria; desempenho/observabilidade/DR; interface, responsividade, acessibilidade, recuperação de erro e evidências em todas as rotas. Preservar funcionalidades e identidade existentes. Sem reescrever a aplicação inteira, inventar funções clínicas, comprar ferramentas, enviar mensagens a clientes ou publicar/deploy nesta etapa.

**Priorização.** Primeiro A01/A02/A03, por exposição de sessão/conteúdo. Preparar contratos e ambiente em paralelo lógico à remoção dos bloqueios de build. Em seguida corrigir entrega/dados e infraestrutura; estabilizar contratos antes de integrar a interface. Polimento não deve atrasar correção de acesso, mas trabalho de design system disjunto pode aproveitar capacidade disponível. Os detalhes e dependências verdadeiras estão em BACKLOG.json; fases do roadmap não substituem o DAG.

**Capacidade e execução.** Host atual: quatro slots totais. Usar um lead, dois builders e uma vaga de crítico; os dois builders só rodam juntos sem colisão de arquivos, schema, lockfile, banco/fixture ou portas. Cartões exclusivos de upgrade/build/typecheck bloqueiam outros writers. Críticos são folhas, read-only e sem histórico. Paralelismo não equivale a um agente por achado iniciado simultaneamente. Inbox/cliente e schema/outbox são fronteiras particularmente acopladas.

Estimativa inicial: **179 pontos relativos**, sem equivalência fixa em horas. Calendário depende de throughput medido, disponibilidade dos serviços e retrabalho. Após AAA-00/01 e primeiro lote integrado, o lead calcula projeção pela velocidade real e folga de revisão/infra. Não foi prometida uma data nem presumida contratação/equipe. Reservar capacidade de crítica e integração em cada marco, não somente no final.

**Responsabilidades.** Lead possui contratos, catálogo e decisões de integração; especialistas produzem implementação e evidências; crítico verifica o candidato sem receber conclusão do builder; responsável pelos dados decide retenção quando necessário; operador disponibiliza ambiente/sandbox e observa indicadores. Aprovação de implantação é ação separada da aprovação técnica e só ocorre se explicitamente solicitada.

**Marcos executivos:** M0 baseline/contratos; M1 acesso e fronteiras; M2 dados/build/mídia; M3 experiência completa; M4 prova operacional; M5 candidato integrado revisado. Demonstrações e critérios de saída no ROADMAP. Todo marco pode rejeitar o produto. Achados do Gauntlet abrem retrabalho no cartão responsável; não se reduz meta para obter verde.

**Riscos e controles.** Banco indisponível: usar infraestrutura isolada dedicada ou CI efêmero, jamais apontar suíte para produção. Migrations concorrentes: dono único e alocação sequencial. Mudança de contrato: invalidar dependentes e reexecutar fronteira. Serviços externos: distinguir mock/sandbox/real. Upgrade amplo: checkout isolado e smoke de imagens. Privacidade: D02 antes de mutação, sem inferir obrigação legal. Critério de desempenho irreal: registrar mudança de workload por evidência em vez de relaxar meta após falha. Detalhes em DECISOES.

**Progresso desta entrega.** Relatório preservado; contratos propostos e catálogo de tarefas entregues; ferramenta de consulta e pacote de execução verificados conforme VERIFICACAO. As tarefas do produto estão PLANNED. A próxima ação de execução é AAA-00: identificar candidato atual e preparar dados/serviços isolados. Fechamento do plano não significa fechamento dos achados nem certificação do programa.
