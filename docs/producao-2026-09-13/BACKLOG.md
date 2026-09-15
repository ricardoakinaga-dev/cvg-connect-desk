# Backlog de produção

> Histórico de planejamento/execução. Estado atual e próximas ações: [auditoria das entregas](../auditorias/2026-09-13-entregas/RELATORIO.md) e [programa R2](../melhorias-2026-09-13/README.md). Requisitos preservados; status e provas abaixo têm o contexto original.

**Fonte canônica:** [BACKLOG.json](BACKLOG.json). Todos os cartões iniciam PLANNED. Checks TO_CREATE são especificações propostas, não comandos já implementados ou executados. Ownership precisa ser confirmado na descoberta.

| Tarefa | Prioridade | Marco | Pontos | Dependências |
|---|---|---|---|---|
| [PROD-00 — Congelar candidato e ambiente de teste reproduzível](tasks/PROD-00.md) | P1 | M0 | 8 | — |
| [PROD-01 — Fechar contratos e decisões de escopo/produção](tasks/PROD-01.md) | P1 | M0 | 5 | PROD-00 |
| [PROD-02 — Corrigir gate mestre e vínculo de evidência ao candidato](tasks/PROD-02.md) | P0 | M0 | 5 | PROD-00 |
| [PROD-03 — Corrigir agregador e política required PR/release/scheduled](tasks/PROD-03.md) | P0 | M0 | 8 | PROD-01, PROD-02 |
| [PROD-04 — Uniformizar permissão de ação e escopo em HTTP/WS](tasks/PROD-04.md) | P0 | M1 | 13 | PROD-01 |
| [PROD-05 — Provar sessão, rotação e revalidação HTTP/WS](tasks/PROD-05.md) | P1 | M1 | 5 | PROD-01, PROD-06 |
| [PROD-06 — Harmonizar schema e timezone; preparar evolução relacional](tasks/PROD-06.md) | P1 | M1 | 5 | PROD-01 |
| [PROD-07 — Tornar recibo de webhook recuperável sem enfraquecer antirreplay](tasks/PROD-07.md) | P0 | M1 | 8 | PROD-01, PROD-06 |
| [PROD-08 — Eliminar conversas órfãs e duplicatas no primeiro inbound](tasks/PROD-08.md) | P0 | M1 | 8 | PROD-07 |
| [PROD-09 — Garantir efeitos idempotentes de worker e falhas observáveis](tasks/PROD-09.md) | P0 | M1 | 8 | PROD-08 |
| [PROD-10 — Mover Secretary para execução durável assíncrona](tasks/PROD-10.md) | P1 | M1 | 8 | PROD-09 |
| [PROD-11 — Validar reconciliação outbound e retenção da intenção](tasks/PROD-11.md) | P1 | M1 | 8 | PROD-08, PROD-10 |
| [PROD-12 — Provar leases, DLQ e fanout entre processos](tasks/PROD-12.md) | P1 | M1 | 8 | PROD-04, PROD-09, PROD-11 |
| [PROD-13 — Fechar budget durável e workflow seguro de ferramentas IA](tasks/PROD-13.md) | P1 | M1 | 8 | PROD-01, PROD-10, PROD-04 |
| [PROD-14 — Conectar mídia inbound à quarentena e acesso privado](tasks/PROD-14.md) | P0 | M1 | 8 | PROD-07, PROD-08 |
| [PROD-15 — Validar upload e resolução autorizada de assets](tasks/PROD-15.md) | P1 | M1 | 5 | PROD-11, PROD-14 |
| [PROD-16 — Fechar escopo de privacidade e política por cópia](tasks/PROD-16.md) | P1 | M1 | 8 | PROD-01, PROD-04, PROD-06 |
| [PROD-17 — Validar sessão inicial e navegação por capacidade](tasks/PROD-17.md) | P1 | M2 | 5 | PROD-04, PROD-05 |
| [PROD-18 — Completar APIs operacionais transacionais e trilha de auditoria](tasks/PROD-18.md) | P1 | M2 | 8 | PROD-04, PROD-08, PROD-09 |
| [PROD-19 — Entregar Inbox com contexto e operação completos](tasks/PROD-19.md) | P1 | M2 | 13 | PROD-17, PROD-18 |
| [PROD-20 — Corrigir timeline, anexos e recuperação de envio](tasks/PROD-20.md) | P1 | M2 | 8 | PROD-19, PROD-15 |
| [PROD-21 — Completar tarefas vinculadas e atribuição](tasks/PROD-21.md) | P1 | M2 | 5 | PROD-18, PROD-17 |
| [PROD-22 — Tornar notas contextuais e navegáveis](tasks/PROD-22.md) | P1 | M2 | 5 | PROD-18, PROD-17 |
| [PROD-23 — Completar alertas acionáveis e geração operacional](tasks/PROD-23.md) | P1 | M2 | 8 | PROD-09, PROD-18, PROD-17 |
| [PROD-24 — Fechar membership de labels, setores e grupos](tasks/PROD-24.md) | P1 | M2 | 5 | PROD-04, PROD-17 |
| [PROD-25 — Consolidar contatos, tutores e pacientes](tasks/PROD-25.md) | P1 | M2 | 11 | PROD-06, PROD-22, PROD-24 |
| [PROD-26 — Completar administração de permissões e auditoria](tasks/PROD-26.md) | P1 | M2 | 8 | PROD-04, PROD-13, PROD-16, PROD-17 |
| [PROD-27 — Completar Kanban funcional e sincronizado](tasks/PROD-27.md) | P1 | M2 | 8 | PROD-18, PROD-19, PROD-24 |
| [PROD-28 — Modularizar frontend e unificar componentes/estados](tasks/PROD-28.md) | P1 | M3 | 8 | PROD-20, PROD-21, PROD-22, PROD-23, PROD-24, PROD-25, PROD-26, PROD-27 |
| [PROD-29 — Fechar responsividade e acessibilidade em toda a aplicação](tasks/PROD-29.md) | P1 | M3 | 8 | PROD-28 |
| [PROD-30 — Completar atualização entre páginas e validade dos KPIs](tasks/PROD-30.md) | P1 | M3 | 5 | PROD-21, PROD-22, PROD-23, PROD-24, PROD-25, PROD-26, PROD-27 |
| [PROD-31 — Endurecer logs, PII e métricas operacionais](tasks/PROD-31.md) | P1 | M3 | 5 | PROD-09, PROD-13, PROD-16, PROD-18 |
| [PROD-32 — Provar tracing real e corrigir smoke de integrações](tasks/PROD-32.md) | P1 | M3 | 8 | PROD-31, PROD-36 |
| [PROD-33 — Implantar SLOs, alertas e validar capacidade](tasks/PROD-33.md) | P1 | M4 | 13 | PROD-12, PROD-29, PROD-30, PROD-32 |
| [PROD-34 — Integrar regressões e coverage efetiva no CI](tasks/PROD-34.md) | P1 | M3 | 8 | PROD-03, PROD-05, PROD-08, PROD-12, PROD-15, PROD-16, PROD-18, PROD-28 |
| [PROD-35 — Sanear cadeia de fornecimento e provar todas as imagens](tasks/PROD-35.md) | P1 | M4 | 8 | PROD-34, PROD-36 |
| [PROD-36 — Fechar boot, health/readiness e implantação remota](tasks/PROD-36.md) | P1 | M3 | 8 | PROD-00, PROD-04, PROD-05, PROD-12 |
| [PROD-37 — Ensaiar backup/restore durável e privacidade pós-desastre](tasks/PROD-37.md) | P1 | M4 | 8 | PROD-06, PROD-16, PROD-36, PROD-25 |
| [PROD-38 — Validar percurso completo com serviços reais isolados](tasks/PROD-38.md) | P1 | M4 | 13 | PROD-19, PROD-20, PROD-21, PROD-22, PROD-23, PROD-24, PROD-25, PROD-26, PROD-27, PROD-29, PROD-30, PROD-32, PROD-34, PROD-35, PROD-37 |
| [PROD-39 — Reconciliar documentação e runbooks com o candidato](tasks/PROD-39.md) | P1 | M5 | 5 | PROD-33, PROD-35, PROD-37, PROD-38 |
| [PROD-40 — Auditoria independente final do candidato integrado](tasks/PROD-40.md) | P1 | M5 | 8 | PROD-00, PROD-01, PROD-02, PROD-03, PROD-04, PROD-05, PROD-06, PROD-07, PROD-08, PROD-09, PROD-10, PROD-11, PROD-12, PROD-13, PROD-14, PROD-15, PROD-16, PROD-17, PROD-18, PROD-19, PROD-20, PROD-21, PROD-22, PROD-23, PROD-24, PROD-25, PROD-26, PROD-27, PROD-28, PROD-29, PROD-30, PROD-31, PROD-32, PROD-33, PROD-34, PROD-35, PROD-36, PROD-37, PROD-38, PROD-39 |
| [PROD-41 — Preparar pacote revisável e decisão go/no-go](tasks/PROD-41.md) | P1 | M5 | 5 | PROD-40 |
| [PROD-42 — Executar entrada controlada em produção quando autorizada](tasks/PROD-42.md) | P1 | M6 | 5 | PROD-41 |
| [PROD-43 — Concluir estabilização e medir SLO de campo](tasks/PROD-43.md) | P1 | M7 | 5 | PROD-42 |
