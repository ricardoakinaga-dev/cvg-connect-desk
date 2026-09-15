# SA-001/AC2 — Revalidação de A01–A10 contra a fonte atual

**Candidato:** HEAD `754f9badac46278e77d21de91c58eedb15e80581` + worktree (493 entradas no congelamento; o rótulo canônico é `754f9bad+worktree`, ver `candidate-manifest.json`).
**Data:** 14/09/2026. **Método:** inspeção estática do código atual com hashes registrados em `candidate-manifest.json`; cada veredito cita arquivo e linha. Nada foi corrigido nesta etapa.

| Achado | Veredito | Evidência atual |
|---|---|---|
| A01 — hash de senha em respostas administrativas | **ABERTO** | `modules/admin/src/infrastructure/repositories/admin.repository.ts:24` (`findById` retorna row completa) e `modules/admin/src/presentation/http/admin.controller.ts:64` (`GET /admin/users/:id` responde a row). POST (`:88`) e PUT (`:110`) devolvem o retorno do use case, que inclui `passwordHash`. Nenhuma projeção/serializer no caminho. |
| A02 — reabertura Kanban mantém conversa inativa | **ABERTO** | `modules/chat/src/infrastructure/repositories/conversation.repository.ts:286` (`updateStatusV2`) define `isActive=false`/`closedAt` para `finalizado`/`arquivado` mas não restaura ao reabrir. `modules/kanban/src/presentation/http/kanban.controller.ts:271` chama o método. |
| A03 — movimento Kanban persiste parcialmente | **ABERTO** | `modules/kanban/src/presentation/http/kanban.controller.ts:271-273`: três escritas independentes (`updateStatusV2`, `updateSector`, `assignUser`) sem transação/histórico/outbox. |
| A04 — Compose produtivo do realtime sem banco | **ABERTO** | `docker-compose.yml` serviço `realtime-service` (bloco ~232): não há `DATABASE_URL` no environment; apenas `REDIS_URL`. `depends_on` inclui postgres mas não configura conexão. |
| A05 — verificador DR aceita restauração parcial | **ABERTO** | `infra/scripts/dr-e2e.sh:118` (`echo "$RESTORED" \| grep -q "$FIXTURE_TAG"`) aceita se qualquer campo contiver a tag; `{"message":"tag","event":null,"dlq":null}` passa. |
| A06 — atalhos da Inbox perdem contexto | **ABERTO** | `apps/desk-web/src/pages/Inbox.tsx:1950-1952` gera `/tasks?conversationId=`, `/notes?conversationId=`, `/alerts?conversationId=`. `Tasks.tsx` não lê a query (nenhum uso de search params; filtros só do estado local); `Notes.tsx:66` consulta `'/notes?mine=true'`; `Alerts.tsx` não lê `conversationId`. |
| A07 — admin e início de atendimento com escrita parcial | **ABERTO** | `modules/admin/src/infrastructure/repositories/admin.repository.ts:66` (`assignRoles` apaga antes de inserir, sem transação); `modules/admin/src/application/use-cases/index.ts:27` (criação de usuário separada da atribuição); `modules/contacts/src/application/use-cases/index.ts:43-65` (conversa e histórico sem transação/outbox abrangente). |
| A08 — dashboards aceitam entradas inconsistentes | **ABERTO** | `modules/dashboard/src/presentation/http/dashboard.controller.ts:90-109`: usa `new Date(...)` e `throw new Error` genérico; `groupBy` sem validação de runtime (enum só no tipo TS). Demais rotas usam schema. |
| A09 — prioridade e acabamento móveis | **ABERTO** | Resumos/filtros antes do trabalho em 375px (auditoria: primeira tarefa ~y=830, alerta crítico ~y=750); `apps/desk-web/src/components/layout/Layout.css:61` mantém `box-shadow:28px 0 80px` na sidebar fora da tela; `apps/desk-web/src/index.css` não possui `@font-face`/carregamento das fontes nomeadas nos tokens; Notes exige seleção/ID técnico. |
| A10 — lacunas de comprovação para release | **ABERTO** | `package.json` (`test:ci` exclui suites `aaa-*`/`production/**`); coverage global não é gate; `infra/prometheus` sem conjunto provisionável completo de dashboards/regras; backup local sem cópia externa durável comprovada. |

## Divergências em relação ao relatório baseline

- Nenhuma correção posterior à auditoria foi identificada nesses dez achados no congelamento. Contagens: auditoria 492 entradas de status; congelamento 493; após a execução do programa, 510 (o programa cria manifestos, testes e evidências — todos com `git_state`/`diff_status` por arquivo no manifesto regenerado). O número de `git status --short` colapsa diretórios não rastreados; o manifesto registra as duas leituras com definições explícitas em `counts`.
- Nenhum aceite foi removido; A01–A10 permanecem executáveis pelas tarefas SA-004–SA-010 e demais produtores do BACKLOG.
