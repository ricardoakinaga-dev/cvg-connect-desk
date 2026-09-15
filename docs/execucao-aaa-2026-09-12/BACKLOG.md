# Backlog AAA — catálogo de planejamento

> Gerado de BACKLOG.json por plan.py; não editar manualmente.

SIMULAÇÃO: todas as tarefas permanecem PLANNED. Cada lote é apenas uma sugestão condicionada à evidência, revisão e integração dos predecessores. Não lança agentes/serviços, não executa checks e não concede aceite.

Baseline: `754f9badac46278e77d21de91c58eedb15e80581`
Auditoria: `docs/auditorias/2026-09-12/RELATORIO.md` — SHA-256 `e72652f18547f59ccb176ed993dde12138dbfb8a68f84b45f4984cd4c7930571`

| Tarefa | Objetivo | Status | Fase | Achados | Áreas | Dependências | Responsável | Risco | Pontos |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [AAA-00](tasks/AAA-00.md) | Revalidar baseline e preparar infraestrutura isolada | PLANNED | 0 | L01 | 14, 18 | — | lead + QA infraestrutura | R2 | 3 |
| [AAA-01](tasks/AAA-01.md) | Congelar contratos e decisões de fronteira | PLANNED | 0 | L01 | 1, 2, 3, 5, 6, 9, 11, 17 | AAA-00 | lead arquitetura/produto | R2 | 3 |
| [AAA-02](tasks/AAA-02.md) | Eliminar o ciclo Chat/Gateway | PLANNED | 1 | A04 | 1, 7, 15 | AAA-01 | backend arquitetura | R2 | 5 |
| [AAA-03](tasks/AAA-03.md) | Unificar validação e renovação de sessões | PLANNED | 1 | A01 | 2, 8 | AAA-01 | backend segurança | R2 | 5 |
| [AAA-04](tasks/AAA-04.md) | Aplicar autorização por recurso em todas rotas relacionadas | PLANNED | 1 | A02 | 3, 4 | AAA-02, AAA-03 | backend autorização | R2 | 8 |
| [AAA-05](tasks/AAA-05.md) | Isolar canais e destinatários realtime | PLANNED | 1 | A03 | 3, 8 | AAA-04 | backend realtime | R2 | 8 |
| [AAA-06](tasks/AAA-06.md) | Corrigir endereço de realtime na implantação web | PLANNED | 1 | A05 | 8, 15 | AAA-01 | frontend/infra | R2 | 3 |
| [AAA-07](tasks/AAA-07.md) | Implementar lease e ACK cercado por proprietário | PLANNED | 2 | A06 | 5, 6, 12 | AAA-02, AAA-01 | backend eventos/dados | R2 | 8 |
| [AAA-08](tasks/AAA-08.md) | Persistir mensagem, estado e outbox atomicamente | PLANNED | 2 | A07 | 5, 6, 7 | AAA-07 | backend transações | R2 | 8 |
| [AAA-09](tasks/AAA-09.md) | Corrigir readiness e dependências operacionais | PLANNED | 1 | A08 | 4, 13, 15 | AAA-01 | backend observabilidade | R2 | 3 |
| [AAA-10](tasks/AAA-10.md) | Unificar contrato e segurança de anexos | PLANNED | 2 | A09 | 4, 11 | AAA-01 | backend mídia | R2 | 8 |
| [AAA-11](tasks/AAA-11.md) | Paginar conversas e selecionar últimas mensagens no banco | PLANNED | 2 | A10 | 5, 9, 12 | AAA-04 | backend consultas | R2 | 5 |
| [AAA-12](tasks/AAA-12.md) | Garantir idempotência transacional no envio | PLANNED | 2 | A11 | 5, 6, 7 | AAA-08, AAA-04 | backend mensagens | R2 | 8 |
| [AAA-13](tasks/AAA-13.md) | Conectar composer ao contrato de envio e anexos | PLANNED | 3 | A09, A11 | 9, 11 | AAA-10, AAA-11, AAA-12 | frontend fluxos | R2 | 5 |
| [AAA-14](tasks/AAA-14.md) | Tornar builds e gates reproduzíveis | PLANNED | 2 | A12 | 1, 14, 15 | AAA-02, AAA-15, AAA-06 | plataforma build | R2 | 5 |
| [AAA-15](tasks/AAA-15.md) | Atualizar dependências e triar alertas | PLANNED | 1 | A13 | 16 | AAA-02 | plataforma supply chain | R2 | 5 |
| [AAA-16](tasks/AAA-16.md) | Eliminar dívida de tipos e lint sem enfraquecer regras | PLANNED | 2 | A12 | 1, 14, 15 | AAA-14 | integrador TypeScript | R2 | 8 |
| [AAA-17](tasks/AAA-17.md) | Cobrir privacidade, retenção e cópias de dados | PLANNED | 3 | A14 | 5, 17 | AAA-01, AAA-08, AAA-12 | backend privacidade | R2 | 8 |
| [AAA-18](tasks/AAA-18.md) | Limitar cardinalidade e proteger métricas | PLANNED | 2 | A15 | 13 | AAA-09 | backend métricas | R2 | 3 |
| [AAA-19](tasks/AAA-19.md) | Vincular autoria de notas à identidade autenticada | PLANNED | 1 | A16 | 3, 17 | AAA-04 | backend notas | R2 | 3 |
| [AAA-20](tasks/AAA-20.md) | Consolidar design system operacional CVG | PLANNED | 2 | L01 | 9, 10 | AAA-01 | frontend design system | R2 | 5 |
| [AAA-21](tasks/AAA-21.md) | Polir Login, Inbox, Dashboard e integração do cliente | PLANNED | 3 | L01 | 9, 10 | AAA-13, AAA-20, AAA-06, AAA-19 | frontend superfícies | R2 | 8 |
| [AAA-22](tasks/AAA-22.md) | Validar acessibilidade e excelência visual independente | PLANNED | 4 | L01 | 9, 10 | AAA-21, AAA-29, AAA-30, AAA-31, AAA-16 | QA acessibilidade + críticos visuais | R2 | 5 |
| [AAA-23](tasks/AAA-23.md) | Executar integração e E2E contra serviços reais | PLANNED | 4 | L01 | 4, 7, 8, 11, 14 | AAA-03, AAA-04, AAA-05, AAA-06, AAA-07, AAA-08, AAA-09, AAA-10, AAA-11, AAA-12, AAA-13, AAA-16, AAA-17, AAA-18, AAA-19, AAA-21, AAA-29, AAA-30, AAA-31 | QA integração | R2 | 8 |
| [AAA-24](tasks/AAA-24.md) | Comprovar migrations e recuperação de desastre | PLANNED | 4 | L01 | 5, 18 | AAA-08, AAA-12, AAA-17, AAA-16 | DBA/SRE | R2 | 5 |
| [AAA-25](tasks/AAA-25.md) | Medir carga, falhas, observabilidade e UX performance | PLANNED | 4 | L01 | 6, 8, 12, 13 | AAA-07, AAA-08, AAA-11, AAA-18, AAA-21, AAA-16, AAA-29, AAA-30, AAA-31 | SRE performance | R2 | 8 |
| [AAA-26](tasks/AAA-26.md) | Executar gates de segurança e evidência CI por SHA | PLANNED | 5 | A12, A13, L01 | 14, 15, 16 | AAA-15, AAA-16, AAA-23, AAA-24, AAA-25, AAA-22 | release engenharia | R2 | 5 |
| [AAA-27](tasks/AAA-27.md) | Reconciliar documentação e runbooks com o candidato | PLANNED | 5 | A06, A12, L01 | 18 | AAA-23, AAA-24, AAA-25, AAA-26 | tech writer técnico/lead | R2 | 3 |
| [AAA-28](tasks/AAA-28.md) | Gauntlet final do candidato integrado | PLANNED | 5 | A01, A02, A03, A04, A05, A06, A07, A08, A09, A10, A11, A12, A13, A14, A15, A16, L01 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18 | AAA-00, AAA-01, AAA-02, AAA-03, AAA-04, AAA-05, AAA-06, AAA-07, AAA-08, AAA-09, AAA-10, AAA-11, AAA-12, AAA-13, AAA-14, AAA-15, AAA-16, AAA-17, AAA-18, AAA-19, AAA-20, AAA-21, AAA-22, AAA-23, AAA-24, AAA-25, AAA-26, AAA-27, AAA-29, AAA-30, AAA-31 | crítico final fresco + lead | R2 | 5 |
| [AAA-29](tasks/AAA-29.md) | Polir cadastros e notas | PLANNED | 3 | L01 | 9, 10 | AAA-13, AAA-20, AAA-06, AAA-19, AAA-21 | frontend páginas 29 | R2 | 5 |
| [AAA-30](tasks/AAA-30.md) | Polir operações e Kanban | PLANNED | 3 | L01 | 9, 10 | AAA-13, AAA-20, AAA-06, AAA-19, AAA-21 | frontend páginas 30 | R2 | 5 |
| [AAA-31](tasks/AAA-31.md) | Polir administração, auditoria e configurações | PLANNED | 3 | L01 | 9, 10 | AAA-13, AAA-20, AAA-06, AAA-19, AAA-21 | frontend páginas 31 | R2 | 5 |
