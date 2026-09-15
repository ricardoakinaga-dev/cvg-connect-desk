# Backlog executivo

**Fonte canônica:** [BACKLOG.json](BACKLOG.json). Este arquivo e os cartões são projeções geradas por `python3 programa.py render`; alterar conteúdo/status no JSON e regenerar. Evidências de execução permanecem em registros próprios.

| ID | Entrega | Prioridade | Frente | Marco | Pontos | Dependências | Estado |
|---|---|---|---|---|---:|---|---|
| [SA-001](tasks/SA-001.md) | Congelar candidato e reconciliar a auditoria | P0 | LEAD | M0 | 3 | — | DONE |
| [SA-002](tasks/SA-002.md) | Fixar contratos, critérios e decisões com alcance preciso | P1 | LEAD | M0 | 5 | SA-001 | DONE |
| [SA-003](tasks/SA-003.md) | Preparar runner e dependências de teste realmente isolados | P0 | OPS | M0 | 8 | SA-001 | REWORK |
| [SA-004](tasks/SA-004.md) | Eliminar hash e dados privados dos DTOs de usuários | P0 | BACKEND | M1 | 3 | SA-001, SA-003 | REWORK |
| [SA-005](tasks/SA-005.md) | Unificar movimento/reabertura Kanban com operação transacional | P0 | BACKEND | M1 | 8 | SA-002, SA-003 | REWORK |
| [SA-006](tasks/SA-006.md) | Tornar operações administrativas atômicas e auditáveis | P1 | BACKEND | M1 | 5 | SA-004 | REWORK |
| [SA-007](tasks/SA-007.md) | Consolidar início de conversa a partir de contato | P1 | BACKEND | M1 | 5 | SA-002, SA-003 | REWORK |
| [SA-008](tasks/SA-008.md) | Preservar contexto da conversa nos atalhos operacionais | P0 | FULLSTACK | M1 | 5 | SA-002, SA-003 | REWORK |
| [SA-009](tasks/SA-009.md) | Configurar e provar banco no realtime produtivo | P0 | OPS | M1 | 3 | SA-002, SA-003 | REWORK |
| [SA-010](tasks/SA-010.md) | Fazer verificador de DR rejeitar restauração parcial | P0 | OPS | M1 | 3 | SA-003 | REWORK |
| [SA-011](tasks/SA-011.md) | Consolidar fronteiras da API e contratos de erro | P1 | BACKEND | M2 | 8 | SA-005, SA-006, SA-007 | REWORK |
| [SA-012](tasks/SA-012.md) | Provar lifecycle completo de sessão HTTP/WS | P1 | BACKEND | M2 | 5 | SA-002, SA-003 | REWORK |
| [SA-013](tasks/SA-013.md) | Completar matriz de autorização e visão gerencial | P1 | BACKEND | M2 | 8 | SA-002, SA-006, SA-012 | REWORK |
| [SA-014](tasks/SA-014.md) | Fechar contrato de mensagem durável e reconciliação | P1 | BACKEND | M2 | 8 | SA-005, SA-007, SA-003 | REWORK |
| [SA-015](tasks/SA-015.md) | Endurecer tarefas vinculadas e concorrência de estados | P1 | BACKEND | M2 | 5 | SA-013, SA-003, SA-008 | REWORK |
| [SA-016](tasks/SA-016.md) | Completar referências e leitura contextual de notas | P1 | BACKEND | M2 | 5 | SA-013, SA-008 | PLANNED |
| [SA-017](tasks/SA-017.md) | Completar alertas automáticos e resolver corrida ack/resolve | P1 | BACKEND | M2 | 8 | SA-013, SA-015 | REWORK |
| [SA-018](tasks/SA-018.md) | Validar transferência ponta a ponta e compensação | P1 | BACKEND | M2 | 5 | SA-013, SA-014 | PLANNED |
| [SA-019](tasks/SA-019.md) | Completar memberships de setores, etiquetas e grupos | P1 | BACKEND | M2 | 8 | SA-013 | REWORK |
| [SA-020](tasks/SA-020.md) | Inventariar e decidir evolução tutor–paciente | P1 | DATA | M2 | 3 | SA-002 | REWORK |
| [SA-021](tasks/SA-021.md) | Implementar relação tutor–paciente e cadastros robustos | P1 | DATA | M2 | 8 | SA-020, SA-013 | PLANNED |
| [SA-022](tasks/SA-022.md) | Consolidar fórmulas, filtros e escopo dos KPIs | P1 | BACKEND | M2 | 5 | SA-013, SA-017, SA-018 | REWORK |
| [SA-023](tasks/SA-023.md) | Fechar trilha auditável em todas as ações relevantes | P1 | BACKEND | M2 | 5 | SA-006, SA-007, SA-005, SA-015, SA-016, SA-017, SA-018, SA-019 | PLANNED |
| [SA-024](tasks/SA-024.md) | Provar schema, migração fresh/upgrade e rollback compatível | P1 | DATA | M2 | 8 | SA-021, SA-014, SA-031, SA-032 | PLANNED |
| [SA-025](tasks/SA-025.md) | Provar leases, DLQ e fanout sob crash físico | P1 | BACKEND | M2 | 8 | SA-014, SA-009 | PLANNED |
| [SA-026](tasks/SA-026.md) | Endurecer loop do worker e recuperação de efeitos | P1 | BACKEND | M2 | 5 | SA-025, SA-017 | PLANNED |
| [SA-027](tasks/SA-027.md) | Completar projeções e revalidação do realtime | P1 | BACKEND | M2 | 5 | SA-013, SA-018, SA-025 | PLANNED |
| [SA-028](tasks/SA-028.md) | Validar Gateway e provedor preservando a borda existente | P1 | INTEGRATION | M2 | 8 | SA-014, SA-025 | PLANNED |
| [SA-029](tasks/SA-029.md) | Provar recuperação durável da Secretary e handoff | P1 | INTEGRATION | M2 | 8 | SA-014, SA-026 | PLANNED |
| [SA-030](tasks/SA-030.md) | Completar política e aprovação de ferramentas IA | P1 | INTEGRATION | M2 | 5 | SA-029, SA-013 | PLANNED |
| [SA-031](tasks/SA-031.md) | Validar privacidade por cópia e recuperação pós-desastre | P1 | BACKEND | M2 | 8 | SA-013, SA-002 | PLANNED |
| [SA-032](tasks/SA-032.md) | Fechar mídia privada com storage/scanner reais | P1 | INTEGRATION | M2 | 8 | SA-003, SA-014 | PLANNED |
| [SA-033](tasks/SA-033.md) | Extrair módulos frontend e consolidar sistema visual | P1 | FRONTEND | M3 | 8 | SA-008, SA-011 | PLANNED |
| [SA-034](tasks/SA-034.md) | Concluir shell, login e navegação por capacidade | P1 | FRONTEND | M3 | 5 | SA-033, SA-012, SA-013 | PLANNED |
| [SA-035](tasks/SA-035.md) | Completar contexto e ações da Inbox | P1 | FRONTEND | M3 | 8 | SA-033, SA-008, SA-015, SA-016, SA-017, SA-018, SA-019 | PLANNED |
| [SA-036](tasks/SA-036.md) | Fechar timeline, anexos e recuperação de envio | P1 | FRONTEND | M3 | 8 | SA-035, SA-032, SA-014 | PLANNED |
| [SA-037](tasks/SA-037.md) | Concluir tarefas contextualizadas e prioridade móvel | P1 | FRONTEND | M3 | 5 | SA-035, SA-015 | PLANNED |
| [SA-038](tasks/SA-038.md) | Entregar notas sem exigir IDs técnicos | P1 | FRONTEND | M3 | 5 | SA-035, SA-016 | PLANNED |
| [SA-039](tasks/SA-039.md) | Entregar alertas acionáveis com urgência visível | P1 | FRONTEND | M3 | 5 | SA-035, SA-017 | PLANNED |
| [SA-040](tasks/SA-040.md) | Completar Kanban acessível e sincronizado | P1 | FRONTEND | M3 | 5 | SA-033, SA-005, SA-019 | PLANNED |
| [SA-041](tasks/SA-041.md) | Concluir jornada de contatos e atendimento | P1 | FRONTEND | M3 | 5 | SA-033, SA-007, SA-019 | PLANNED |
| [SA-042](tasks/SA-042.md) | Concluir fichas de tutores e pacientes | P1 | FRONTEND | M3 | 5 | SA-033, SA-021 | PLANNED |
| [SA-043](tasks/SA-043.md) | Concluir gestão de setores, etiquetas e grupos | P1 | FRONTEND | M3 | 5 | SA-033, SA-019 | PLANNED |
| [SA-044](tasks/SA-044.md) | Concluir administração de permissões, filas, times e DLQ | P1 | FRONTEND | M3 | 8 | SA-033, SA-006, SA-013, SA-030 | PLANNED |
| [SA-045](tasks/SA-045.md) | Concluir busca de auditoria e perfil/configurações | P1 | FRONTEND | M3 | 5 | SA-033, SA-023, SA-012 | PLANNED |
| [SA-046](tasks/SA-046.md) | Concluir dashboard acionável e fiel às métricas | P1 | FRONTEND | M3 | 5 | SA-033, SA-022 | PLANNED |
| [SA-047](tasks/SA-047.md) | Completar sincronização entre operadores e páginas | P1 | FRONTEND | M3 | 8 | SA-027, SA-035, SA-036, SA-037, SA-038, SA-039, SA-040, SA-041, SA-042, SA-043, SA-044, SA-045, SA-046 | PLANNED |
| [SA-048](tasks/SA-048.md) | Fechar matriz visual e acessibilidade manual | P1 | DESIGN_QA | M3 | 8 | SA-034, SA-047 | PLANNED |
| [SA-049](tasks/SA-049.md) | Construir regressão E2E por jornada e estados | P1 | QA | M3 | 8 | SA-034, SA-047 | PLANNED |
| [SA-050](tasks/SA-050.md) | Fechar CI por escopo e cobertura efetiva | P1 | QA | M4 | 8 | SA-024, SA-025, SA-026, SA-030, SA-032, SA-049, SA-063 | PLANNED |
| [SA-051](tasks/SA-051.md) | Vincular supply chain às imagens realmente entregues | P1 | OPS | M4 | 8 | SA-050, SA-052 | PLANNED |
| [SA-052](tasks/SA-052.md) | Provar boot, readiness e rollout de todos os runtimes | P1 | OPS | M3 | 8 | SA-009, SA-024, SA-026, SA-032 | PLANNED |
| [SA-053](tasks/SA-053.md) | Entregar tracing e métricas úteis com minimização | P1 | OPS | M3 | 8 | SA-023, SA-026, SA-029, SA-032, SA-052 | PLANNED |
| [SA-054](tasks/SA-054.md) | Provisionar dashboards, alertas e SLOs operacionais | P1 | OPS | M4 | 5 | SA-053 | PLANNED |
| [SA-055](tasks/SA-055.md) | Ensaiar backup durável, restore e privacidade pós-restore | P1 | OPS | M4 | 8 | SA-010, SA-024, SA-031, SA-052 | PLANNED |
| [SA-056](tasks/SA-056.md) | Medir e otimizar carga, queries e web vitals | P1 | PERFORMANCE | M4 | 13 | SA-022, SA-047, SA-048, SA-052, SA-054 | PLANNED |
| [SA-057](tasks/SA-057.md) | Reconciliar documentos e runbooks por afirmação | P1 | DOCS | M4 | 8 | SA-050, SA-051, SA-054, SA-055, SA-056, SA-058 | PLANNED |
| [SA-058](tasks/SA-058.md) | Executar jornada integrada com serviços representativos | P1 | QA | M4 | 13 | SA-028, SA-029, SA-030, SA-032, SA-047, SA-049, SA-051, SA-055 | PLANNED |
| [SA-059](tasks/SA-059.md) | Auditar candidato integrado e pontuar todos os itens | P0 | CRITIC | M5 | 8 | SA-001, SA-002, SA-003, SA-004, SA-005, SA-006, SA-007, SA-008, SA-009, SA-010, SA-011, SA-012, SA-013, SA-014, SA-015, SA-016, SA-017, SA-018, SA-019, SA-020, SA-021, SA-022, SA-023, SA-024, SA-025, SA-026, SA-027, SA-028, SA-029, SA-030, SA-031, SA-032, SA-033, SA-034, SA-035, SA-036, SA-037, SA-038, SA-039, SA-040, SA-041, SA-042, SA-043, SA-044, SA-045, SA-046, SA-047, SA-048, SA-049, SA-050, SA-051, SA-052, SA-053, SA-054, SA-055, SA-056, SA-057, SA-058, SA-063 | PLANNED |
| [SA-060](tasks/SA-060.md) | Preparar pacote executivo de release e go/no-go | P1 | LEAD | M5 | 5 | SA-059 | PLANNED |
| [SA-061](tasks/SA-061.md) | Executar implantação controlada quando autorizada | P1 | OPS | M6 | 5 | SA-060 | PLANNED |
| [SA-062](tasks/SA-062.md) | Estabilizar operação e medir SLO de campo | P1 | OPS | M7 | 8 | SA-061 | PLANNED |
| [SA-063](tasks/SA-063.md) | Elevar disciplina TypeScript/lint e manutenção | P1 | QUALITY | M3 | 8 | SA-011, SA-033 | PLANNED |

**Total:** 63 tarefas, 411 pontos relativos. Não são horas nem datas prometidas.
