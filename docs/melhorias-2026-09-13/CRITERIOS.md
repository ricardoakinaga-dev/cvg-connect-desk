# Critérios de aceitação para produção

**Todos obrigatórios para qualificar o próximo candidato. Esta revisão começa com provas NOT_RUN; a auditoria de entregas registra os resultados atuais e seus limites.** Aceitar somente resultados vinculados ao mesmo candidato. Teste ausente ou infraestrutura indisponível gera bloqueio, nunca PASS. As tarefas listadas produzem a evidência; PROD-40 inspeciona independentemente.

| Gate | Condição | Tarefas principais |
|---|---|---|
| G01 | Baseline, ambiente isolado e evidência íntegra; adversariais do gate rejeitados; CI required correto por evento | 00,02,03 |
| G02 | Sessão e autorização HTTP/WS por ação/recurso, negativos de revogação e acesso cruzado | 04,05,17,26 |
| G03 | Atomicidade, retry, crash, idempotência e reconciliação em ingresso/worker/outbound/realtime | 07–12 |
| G04 | Mídia privada com scan real, fail-closed, limites, SSRF e leitura autorizada | 14,15,20,32 |
| G05 | Dados, migração fresh e upgrade, IA e privacidade sob políticas ratificadas | 06,13,16,25 |
| G06 | Atendimento completo e administração, sem controles inertes nem estados enganosos | 18–27,30,38 |
| G07 | Matriz visual/a11y e design system aplicados, navegação assistiva demonstrada | 28,29 |
| G08 | Lint/typecheck/build/regressões e coverage real com denominadores congelados, nenhum skip requerido | 34 |
| G09 | Imagens entregues por digest, scans/SBOM, configuração e readiness reais, rollout compatível | 35,36 |
| G10 | Tracing completo, métricas privadas, dashboards e alertas com falha/recuperação | 31–33 |
| G11 | Carga/SQL/vitals e backup/restore dentro dos orçamentos herdados | 33,37 |
| G12 | E2E real, documentação reproduzível, rastreabilidade completa e crítica independente sem pendência obrigatória | 38–40 |

## Orçamentos congelados a revalidar em PROD-01

Preservar os requisitos vigentes de AAA-25/QUALIDADE e DESIGN_QA do plano de 12/09; esclarecer divergências antes de medir, sem reduzir meta porque houve falha. Perfil: 10 mil conversas, 100 mil mensagens e 100 sessões; 10min de aquecimento + 30min de medição, três rodadas com ambiente declarado. P95 inbound <250ms, realtime <500ms, erros inesperados <0,1%; zero perda/efeito duplicado nos cenários determinísticos.

Browser: LCP ≤2,5s, INP ≤200ms, CLS ≤0,1 no perfil estabelecido; JS inicial gzip ≤120KiB e CSS ≤25KiB. Coverage: core≥90%, domínio≥80%, API≥70%, web≥60%, global≥75%; preservar thresholds shared mais restritivos (85/80/85/85), registrar ordem das métricas e denominadores no contrato. Medição de laboratório e percentis de campo têm relatórios distintos.

Matriz visual: 16 rotas canônicas em 375×812, 390×844, 768×1024, 1024×768 e 1440×900; estados críticos no menor viewport e desktop, tablets quando houver comportamento diferente; fronteiras860/1260, zoom/reflow, teclado, foco, reduced motion, contraste e leitor de tela real. WCAG2.2AA aplicável; alvo interno44×44 não é descrito como exigência universal WCAG. Usar o inventário completo de DESIGN_QA; incluir shell/deep-links.

DR: RPO≤24h e RTO≤2h medidos com backup durável e restauração real. Disponibilidade mensal: API99,9% e webhook99,95%, com orçamento correto da janela; não exigir histórico de produção anterior ao primeiro deploy.

## Estados e validade

IMPLEMENTED significa código concluído; VERIFIED exige provas dos aceites; DONE exige integração e revisão. READY_FOR_RELEASE só surge após PROD-40; autorização de implantação é decisão própria. IN_PRODUCTION exige observação da implantação; operação estabilizada e SLO mensal exigem PROD-43.

Cada prova registra candidato/commit e diff se houver, source hash, lock hash, digests, comando, ferramenta, início/fim, ambiente, run/attempt, resultado e hash dos artefatos. Mudança invalida provas afetadas; candidato final requer conjunto coerente. FAIL/BLOCKED/STALE/NOT_RUN e skip requerido bloqueiam. Exceções de supply chain exigem autoridade, alcance, compensação e validade; não dispensam falhas demonstradas de acesso ou dados. Notas AAA históricas não concedem aprovação.
