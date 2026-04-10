# Relatório Executivo: Rastreabilidade entre Documentação e Código

**Data:** 2026-04-09  
**Base:** cruzamento entre a documentação em `/docs` e a implementação atual do monorepo  
**Objetivo:** registrar, em formato executivo, o nível de aderência entre o que está documentado e o que existe no código

## 1. Resumo Executivo

O projeto possui boa aderência estrutural entre arquitetura documentada e implementação real. A maior parte dos domínios, runtimes e módulos previstos já existe no código. O principal problema atual não é falta de implementação global, e sim:

- documentos de auditoria antigos que ficaram desatualizados;
- diferença entre arquitetura alvo e maturidade real do pipeline assíncrono;
- gap de segurança na autenticação do realtime;
- alguns itens documentados como operacionais que ainda são apenas parcialmente verdadeiros.

## 2. Legenda de Status

- **Aderente**: a claim documental está confirmada no código atual.
- **Parcial**: a claim está parcialmente atendida, mas com limitações relevantes.
- **Divergente**: a claim documental não corresponde mais ao estado do código.
- **Alvo Futuro**: a claim é válida como direção arquitetural, mas ainda não foi concluída tecnicamente.

## 3. Tabela Executiva

| Documento | Claim | Evidência no código | Status | Ação recomendada |
|---|---|---|---|---|
| `docs/04-target-architecture.md` | `desk-api`, `message-worker`, `realtime-service` e `desk-web` são os papéis centrais da arquitetura | Existem `apps/desk-api`, `apps/message-worker`, `apps/realtime-service` e `apps/desk-web`; ver [apps/desk-api/src/index.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/apps/desk-api/src/index.ts), [apps/message-worker/src/index.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/apps/message-worker/src/index.ts), [apps/realtime-service/src/index.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/apps/realtime-service/src/index.ts), [apps/desk-web/src/App.tsx](/home/ricardo/.openclaw/workspace/cvg-connect-desk/apps/desk-web/src/App.tsx) | Aderente | Manter |
| `docs/04-target-architecture.md` | `message-worker` consome efeitos assíncronos de eventos já persistidos | O worker lê `eventPublisher.getEvents()` localmente em [apps/message-worker/src/index.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/apps/message-worker/src/index.ts#L141), enquanto o publisher é `InMemoryEventPublisher` em [packages/events/src/publisher.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/packages/events/src/publisher.ts#L8) | Parcial | Migrar para mecanismo interprocesso real |
| `docs/04-target-architecture.md` | `realtime-service` projeta eventos já persistidos para o frontend | O serviço existe e consome `/events` da API em [apps/realtime-service/src/index.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/apps/realtime-service/src/index.ts#L217) | Parcial | Manter projeção, mas corrigir autenticação e origem de eventos |
| `docs/05-domain-model.md` | Chat, Tasks, Notes, Alerts, IAM e Audit são domínios centrais | Todos esses domínios aparecem no schema em [packages/database/src/schema.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/packages/database/src/schema.ts#L46) e nos módulos em `modules/` | Aderente | Manter |
| `docs/06-integration-contracts.md` | Inbound deve ser validado na fronteira e processado com idempotência | Há guard de webhook em [packages/shared/src/webhook-guard.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/packages/shared/src/webhook-guard.ts#L10) e idempotência por `externalMessageId` em [modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts#L42) | Parcial | Tornar proteção do webhook obrigatória em ambientes operacionais |
| `docs/07-backend-architecture.md` | A API é a fonte primária de verdade e publica eventos após persistência | A API persiste e publica em casos como inbound de chat; ver [modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts#L111) e [modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts#L128) | Aderente | Manter |
| `docs/07-backend-architecture.md` | `message-worker` executa efeitos secundários fora do fluxo síncrono | O worker existe, tem handlers e retry em [apps/message-worker/src/index.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/apps/message-worker/src/index.ts#L128) | Parcial | Corrigir transporte de eventos entre processos |
| `docs/08-frontend-architecture.md` | O frontend é camada operacional, não fonte da verdade | O frontend consome API e trata realtime como atualização incremental; ver [apps/desk-web/src/pages/Inbox.tsx](/home/ricardo/.openclaw/workspace/cvg-connect-desk/apps/desk-web/src/pages/Inbox.tsx#L43) e [apps/desk-web/src/pages/Inbox.tsx](/home/ricardo/.openclaw/workspace/cvg-connect-desk/apps/desk-web/src/pages/Inbox.tsx#L53) | Aderente | Manter |
| `docs/08-frontend-architecture.md` | A aplicação web deve ter inbox, dashboard, administração e áreas operacionais | As rotas existem em [apps/desk-web/src/App.tsx](/home/ricardo/.openclaw/workspace/cvg-connect-desk/apps/desk-web/src/App.tsx#L31) | Aderente | Manter |
| `docs/09-data-model.md` | O banco deve manter estado atual e histórico operacional | O schema possui `conversation_status_history`, `task_status_history` e `alert_events`; ver [packages/database/src/schema.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/packages/database/src/schema.ts#L74), [packages/database/src/schema.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/packages/database/src/schema.ts#L152), [packages/database/src/schema.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/packages/database/src/schema.ts#L204) | Aderente | Manter |
| `docs/09-data-model.md` | O plano enterprise inclui labels, sectors, groups, transfers e user-sectors | Essas estruturas estão implementadas em [packages/database/src/schema.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/packages/database/src/schema.ts#L309) | Aderente | Manter |
| `docs/10-realtime-and-events.md` | Frontend não deve depender exclusivamente do realtime para bootstrap de estado | O Inbox continua carregando via API e usa polling de fallback em [apps/desk-web/src/pages/Inbox.tsx](/home/ricardo/.openclaw/workspace/cvg-connect-desk/apps/desk-web/src/pages/Inbox.tsx#L94) | Aderente | Manter |
| `docs/10-realtime-and-events.md` | O realtime deve tolerar reconnect e revalidação | O client possui reconnect e resubscribe em [apps/desk-web/src/lib/realtime.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/apps/desk-web/src/lib/realtime.ts#L84) | Aderente | Manter |
| `docs/10-realtime-and-events.md` | Consumidores internos devem ser seguros contra reprocessamento | Há consumer e retry em `packages/events`, mas a entrega real continua em memória; ver [packages/events/src/publisher.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/packages/events/src/publisher.ts#L8) | Parcial | Implementar persistência/outbox/fila real |
| `docs/11-security-and-access-control.md` | O sistema deve usar autenticação de usuários internos e RBAC real | Há middleware de auth em [packages/auth/src/middleware.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/packages/auth/src/middleware.ts#L17) e RBAC em [packages/auth/src/rbac-middleware.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/packages/auth/src/rbac-middleware.ts#L15) | Aderente | Manter |
| `docs/11-security-and-access-control.md` | O webhook deve ter proteção separada da autenticação interna | O webhook usa guard específico em [modules/chat/src/presentation/http/webhook-inbound.controller.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/modules/chat/src/presentation/http/webhook-inbound.controller.ts#L17) | Aderente | Manter |
| `docs/11-security-and-access-control.md` | O webhook deve rejeitar payload inválido cedo e validar assinatura/origem quando possível | A assinatura HMAC existe, mas é opcional quando `WEBHOOK_SECRET` não está definido; ver [packages/shared/src/webhook-guard.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/packages/shared/src/webhook-guard.ts#L13) | Parcial | Exigir secret em ambientes produtivos |
| `docs/11-security-and-access-control.md` | O canal realtime deve exigir identidade validada e autorização coerente | O client envia `token` e `userId`, mas o servidor aceita `userId` sem validar sessão em banco; ver [apps/desk-web/src/lib/realtime.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/apps/desk-web/src/lib/realtime.ts#L37) e [apps/realtime-service/src/index.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/apps/realtime-service/src/index.ts#L112) | Divergente | Implementar auth real no handshake/canal |
| `docs/12-audit-and-observability.md` | Deve existir audit trail persistido e rastreável | `audit_logs` existe no schema em [packages/database/src/schema.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/packages/database/src/schema.ts#L284) e o módulo audit está registrado na API em [apps/desk-api/src/index.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/apps/desk-api/src/index.ts#L16) | Aderente | Manter |
| `docs/12-audit-and-observability.md` | Logs e rastreabilidade devem ser coerentes ponta a ponta | Há logs operacionais, mas sem padronização completa e sem correlação forte no pipeline inteiro | Parcial | Padronizar logging estruturado e correlação |
| `docs/13-dashboard-and-kpis.md` | Dashboard deve expor KPIs operacionais mínimos | Endpoints de summary, conversations, volume, tasks e alerts existem em [modules/dashboard/src/presentation/http/dashboard.controller.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/modules/dashboard/src/presentation/http/dashboard.controller.ts#L14) | Parcial | Completar KPIs temporais e handoff |
| `docs/13-dashboard-and-kpis.md` | Tempo médio de primeira resposta, tempo médio de resposta e taxa de handoff devem existir como KPIs definidos | Esses endpoints/cálculos não aparecem no módulo dashboard atual | Alvo Futuro | Planejar dados e cálculos antes de expor |
| `docs/18-deployment-and-runtime.md` | Os runtimes implementados são `desk-api`, `desk-web`, `message-worker` e `realtime-service` | Isso corresponde ao repositório atual | Aderente | Manter |
| `docs/18-deployment-and-runtime.md` | `realtime-service` usa porta padrão 3001 | O código usa `8080` por padrão em [apps/realtime-service/src/index.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/apps/realtime-service/src/index.ts#L23) | Divergente | Atualizar documento |
| `docs/18-deployment-and-runtime.md` | Rate limiting ainda não está implementado | Rate limiting está ativo em [apps/desk-api/src/index.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/apps/desk-api/src/index.ts#L95) | Divergente | Atualizar documento |
| `docs/19-test-strategy.md` | Deve existir uma base mínima de smoke, unidade e integração | Há testes em apps, packages e módulos; a lista atual pode ser verificada em `src/__tests__` e `pnpm test` passa | Parcial | Evoluir profundidade e cobertura |
| `docs/20-master-execution-log.md` | O repositório evoluiu por fases de foundation, chat, operations, secretary, worker e realtime | O histórico é coerente com os artefatos existentes em apps/modules/packages | Aderente | Manter como documento histórico |
| `docs/21-instalacao-local.md` | Os scripts de banco da raiz são placeholders e os comandos corretos estão em `@cvg/database` | Isso é confirmado por [package.json](/home/ricardo/.openclaw/workspace/cvg-connect-desk/package.json#L12) e [packages/database/package.json](/home/ricardo/.openclaw/workspace/cvg-connect-desk/packages/database/package.json#L12) | Aderente | Manter |
| `docs/21-instalacao-local.md` | O guia usa o estado real do código atual | É o documento de setup mais fiel ao repositório atual | Aderente | Usar como referência primária de setup |
| `docs/22-enterprise-premium-plan.md` | O plano enterprise exige labels, sectors, groups, transfers e kanban | Essas bases já existem em schema, módulos e frontend; ver [packages/database/src/schema.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/packages/database/src/schema.ts#L309), [modules/kanban/src/presentation/http/kanban.controller.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/modules/kanban/src/presentation/http/kanban.controller.ts#L15), [apps/desk-web/src/App.tsx](/home/ricardo/.openclaw/workspace/cvg-connect-desk/apps/desk-web/src/App.tsx#L35) | Parcial | Marcar no documento o que já foi absorvido |
| `docs/23-auditoria-executiva.md` | Testes são ausentes e zero implementação existe | `pnpm test` passou e há múltiplos arquivos de teste em apps/modules/packages | Divergente | Reclassificar como auditoria histórica |
| `docs/23-auditoria-executiva.md` | Realtime não está conectado ao frontend | O Inbox já usa `realtimeClient.connect(...)` em [apps/desk-web/src/pages/Inbox.tsx](/home/ricardo/.openclaw/workspace/cvg-connect-desk/apps/desk-web/src/pages/Inbox.tsx#L58) | Divergente | Atualizar ou arquivar documento |
| `docs/23-auditoria-executiva.md` | Secretary não está integrada ao fluxo inbound | O inbound chama `processMessageWithSecretary(...)` em [modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts#L150) | Divergente | Atualizar ou arquivar documento |
| `docs/23-auditoria-executiva.md` | Kanban move não está confirmado | O endpoint `PATCH /kanban/card/:id/move` existe em [modules/kanban/src/presentation/http/kanban.controller.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/modules/kanban/src/presentation/http/kanban.controller.ts#L89) | Divergente | Atualizar e complementar com teste funcional |
| `docs/24-plano-implementacao-enterprise.md` | Realtime ativo, Secretary ativada, kanban move e hardening final são fases necessárias | O plano ainda é útil como backlog de hardening, mas parte da base já foi implementada | Parcial | Rebaselinar plano a partir do estado atual |
| `docs/25-plano-testes-completo.md` | É necessário expandir a suíte por camadas até E2E | O repositório tem base inicial de testes, mas ainda sem cobertura enterprise profunda | Aderente | Usar como roteiro de evolução |
| `docs/AUDITORIA_IMPLEMENTACAO.md` | `admin` está vazio e sem controller/repository/use case | Existe controller em [modules/admin/src/presentation/http/admin.controller.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/modules/admin/src/presentation/http/admin.controller.ts#L21) e rotas registradas na API em [apps/desk-api/src/index.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/apps/desk-api/src/index.ts#L17) | Divergente | Atualizar ou arquivar documento |
| `docs/AUDITORIA_IMPLEMENTACAO.md` | Secretary não está integrada ao inbound | O código atual contradiz isso em [modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts#L145) | Divergente | Atualizar ou arquivar documento |
| `docs/AUDITORIA_IMPLEMENTACAO.md` | Eventos de handoff não estão sendo publicados | `triggerHandoff` publica `handoff.requested` e `handoff.completed` em [modules/secretary-adapter/src/application/use-cases/trigger-handoff.use-case.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/modules/secretary-adapter/src/application/use-cases/trigger-handoff.use-case.ts#L33) | Divergente | Atualizar documento |
| `docs/AUDITORIA_IMPLEMENTACAO.md` | `tasks` não têm `tutorId` e `patientId` | Esses campos existem em [packages/database/src/schema.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/packages/database/src/schema.ts#L128) | Divergente | Atualizar documento |
| `docs/AUDITORIA_IMPLEMENTACAO.md` | `notes` não suportam `reference_type` genérico | O enum e os campos existem em [packages/database/src/schema.ts](/home/ricardo/.openclaw/workspace/cvg-connect-desk/packages/database/src/schema.ts#L163) | Divergente | Atualizar documento |
| `README.md` | O sistema tem API, frontend, worker, realtime e banco como serviços centrais | A estrutura geral está correta e coerente com o repositório atual | Aderente | Manter |
| `README.md` | O setup rápido é suficiente sem ressalvas | O setup precisa do contexto adicional de que `pnpm db:migrate` e `pnpm db:seed` da raiz são placeholders; ver [package.json](/home/ricardo/.openclaw/workspace/cvg-connect-desk/package.json#L12) | Parcial | Apontar explicitamente para `docs/21-instalacao-local.md` |

## 4. Achados Prioritários

### 4.1 Críticos

- O pipeline de eventos entre API, worker e realtime ainda depende de memória local de processo.
- O realtime não valida de forma forte a identidade do usuário conectado.

### 4.2 Altos

- Auditorias em `docs/23-auditoria-executiva.md` e `docs/AUDITORIA_IMPLEMENTACAO.md` estão desatualizadas e hoje induzem erro.
- `docs/18-deployment-and-runtime.md` contém divergências operacionais concretas, incluindo porta do realtime e status de rate limiting.

### 4.3 Médios

- O dashboard ainda não cobre todos os KPIs mais sofisticados documentados.
- O webhook tem mecanismo de proteção válido, mas opcional quando a configuração não é aplicada.
- A suíte de testes existe, mas ainda não tem profundidade enterprise.

## 5. Recomendações Executivas

### Recomendação 1

Reclassificar documentos em `/docs` com selo explícito:

- `estado atual`;
- `histórico`;
- `alvo futuro`;
- `auditoria desatualizada`.

### Recomendação 2

Implementar um mecanismo real de transporte assíncrono entre processos:

- outbox no banco;
- Redis;
- broker;
- solução equivalente.

### Recomendação 3

Fortalecer a autenticação do realtime com validação real de sessão/token no servidor.

### Recomendação 4

Atualizar imediatamente:

- `docs/23-auditoria-executiva.md`
- `docs/AUDITORIA_IMPLEMENTACAO.md`
- `docs/18-deployment-and-runtime.md`
- `README.md`

### Recomendação 5

Expandir testes de comportamento para:

- auth;
- inbound idempotente;
- integração Secretary;
- kanban move;
- webhook security;
- realtime auth.

## 6. Conclusão

O projeto apresenta aderência estrutural alta entre documentação-base e implementação real. O principal risco hoje não é falta de produto construído, mas a coexistência de documentos antigos com o código atual e a distância entre arquitetura desejada e infraestrutura assíncrona realmente operacional.

Em resumo:

- o produto está mais implementado do que parte da documentação sugere;
- a documentação não está mais unificada como fonte única da verdade;
- os gaps mais importantes restantes são técnicos e concentrados, não generalizados.
