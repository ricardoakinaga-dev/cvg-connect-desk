# Roadmap

> Histórico de planejamento/execução. Estado atual e próximas ações: [auditoria das entregas](../auditorias/2026-09-13-entregas/RELATORIO.md) e [programa R2](../melhorias-2026-09-13/README.md). Requisitos preservados; status e provas abaixo têm o contexto original.

Os marcos agrupam entregas; as dependências de cada cartão determinam a ordem efetiva. M3 pode avançar durante M2 quando seus predecessores estiverem concluídos. A execução começa por PROD-00, seguida de PROD-01 e PROD-02 em frentes independentes se não houver colisão.

| Marco | Entrega | Tarefas | Pontos | Saída demonstrável |
|---|---|---|---|---|
| M0 — Fundação confiável | Fundação confiável | PROD-00, PROD-01, PROD-02, PROD-03 | 26 | Snapshot, contratos e gates adversariais rejeitando evidência falsa. |
| M1 — Garantias do backend | Garantias do backend | PROD-04, PROD-05, PROD-06, PROD-07, PROD-08, PROD-09, PROD-10, PROD-11, PROD-12, PROD-13, PROD-14, PROD-15, PROD-16 | 100 | Acesso, ingresso, efeitos, integrações, mídia e dados comprovados sob falhas. |
| M2 — Produto operacional | Produto operacional | PROD-17, PROD-18, PROD-19, PROD-20, PROD-21, PROD-22, PROD-23, PROD-24, PROD-25, PROD-26, PROD-27 | 84 | Percurso completo utilizável, estados verdadeiros e contexto hospitalar autorizado. |
| M3 — Qualidade e plataforma | Qualidade e plataforma | PROD-28, PROD-29, PROD-30, PROD-31, PROD-32, PROD-34, PROD-36 | 50 | Regressões integradas, configuração efetiva, probes, logs e tracing real. |
| M4 — Qualificação integrada | Qualificação integrada | PROD-33, PROD-35, PROD-37, PROD-38 | 42 | E2E, capacidade, imagens e recuperação reais aprovados. |
| M5 — Candidato e decisão | Candidato e decisão | PROD-39, PROD-40, PROD-41 | 18 | Documentação reconciliada, crítica independente e pacote de release revisável. |
| M6 — Entrada controlada | Entrada controlada | PROD-42 | 5 | Implantação autorizada, piloto e expansão sob critérios de abortar. |
| M7 — Estabilização | Estabilização | PROD-43 | 5 | Janela de observação concluída, SLO de campo e rotinas operacionais demonstradas. |

## Sequência de integração

1. Congelar candidato e contrato da evidência; reparar gates antes de confiar em novas aprovações.
2. Fechar autorização e schema; tornar inbound e efeitos duráveis, depois Secretary, outbound, mídia e fanout.
3. Integrar sessão e APIs operacionais; completar telas por fluxo. Um dono integra Inbox, outro Admin; extrações necessárias entram no cartão do fluxo e PROD-28 fecha a composição.
4. Consolidar responsive/a11y e convergência realtime; executar gates de CI, infraestrutura, supply chain e integração externa.
5. Rodar E2E real, carga e DR; corrigir e repetir apenas provas afetadas, preservando a identidade do candidato.
6. Reconciliar documentação, revisar independentemente e preparar a decisão de release.
7. Implantar com autorização; observar piloto, estabilização e janela mensal de SLO.

## Dependências e paralelismo

O [backlog estruturado](BACKLOG.json) contém o DAG completo. Um cartão está elegível quando todos os predecessores estão DONE e suas decisões/recursos necessários estão disponíveis. Elegibilidade não concede permissão de escrita simultânea: `ownership`, `locks`, banco, provider e ambiente também precisam ser disjuntos. Worktrees não isolam bancos ou numeração de migrations. O integrador serializa colisões e interrompe a lane quando o contrato muda.

Datas serão adicionadas após medir velocidade em entregas aceitas. A janela mensal de disponibilidade ocorre depois do deploy; não bloqueia circularmente o primeiro lançamento. Falha em marco obrigatório impede a promoção seguinte, mas permite trabalho independente.
