# Contratos de execução — C01 a C10 (versão C-1, congelada por SA-002)

**Versão do contrato:** C-1 · **Data:** 14/09/2026 · **Dono da mudança:** lead do programa · **Estado:** congelado para execução; mudanças exigem o procedimento da última seção.
**Revalidação SA-002-R3-A1:** 15/09/2026 · **Candidato:** `754f9badac46278e77d21de91c58eedb15e80581+worktree#product-4ee19f2ec5ca8bff` · `product_sha256=4ee19f2e…`; o `ledger_sha256` corrente fica no manifesto e no registro de ambiente da execução.

Preservar contratos existentes que já satisfaçam estes invariantes. Não criar nova stack, broker ou serviço por preferência arquitetural. Cada contrato abaixo declara **proprietário, entradas, saídas, consumidores e exemplos de sucesso/erro**; exemplos citam código real e os testes que os verificam ou, quando ainda não existem, a tarefa que os cria.

| ID | Fronteira / dono | Invariante e prova de aceitação | Entradas → saídas | Consumidores |
|---|---|---|---|---|
| C01 | Comando de domínio / backend | Ação autorizada valida estado/versão, persiste entidade+histórico+audit+outbox atomicamente e emite hints só após commit. Sucesso corresponde a efeito durável; conflito 409 não sobrescreve trabalho alheio. Falha tardia reverte tudo. | `{actor, targetId, expectedVersion?, payload}` → `{entity, auditId, outboxEventIds, hints}` ou `400/401/403/404/409/500` | desk-api (controllers), message-worker, realtime-service, desk-web |
| C02 | Identidade e autorização / segurança backend | Sessão opaca continua; ação e recurso/setor são avaliados em HTTP e WS. Projeções/seletores não revelam dados proibidos. Revogação ≤5s no cenário definido. DTO público nunca serializa hash/token. Visão global exige política D01 explícita. | `{sessionToken/opaque, action, resource}` → `{allowed, statusCode}`; DTO público → campos permitidos | desk-api, realtime-service (WS), desk-web, auditoria |
| C03 | Mensagens e efeitos externos / integrações | Idempotency key, hash de payload, IDs externos e correlação têm escopo definido. Estado pending/accepted/unknown/failed/completed tem transição clara. Aceite desconhecido reconcilia antes de reenvio; provider real não recebe duplicata por retry indiscriminado. | `{idempotencyKey, payloadHash, externalId?}` → `{state, externalId, attempts}` | chat, message-worker, gateway-adapter, desk-api (webhook) |
| C04 | Contexto de navegação / fullstack | `conversationId/referenceType/referenceId` são tipados, validados e aplicados no servidor com autorização e paginação. URL→requisição→resultado→criação→retorno conserva entidade. Sem vínculo não entra em lista contextual. Consulta minhas notas não equivale a notas da conversa. | `?conversationId=&referenceType=&referenceId=&page=` → lista filtrada + metadados de paginação | Inbox, Tasks, Notes, Alerts (desk-web), módulos tasks/notes/alerts |
| C05 | Evento e convergência / backend+frontend | Catálogo de envelopes versionados define ID, tipo, agregado, versão, causalidade, destinatários e queries afetadas. Duplicata/ordem inversa não regride estado. Cada omissão de projeção tem fallback bounded e teste; atualização normal P95<500ms, fallback ≤5s no cenário funcional. | `EventEnvelope{id,type,aggregateType,aggregateId,version,correlationId,payload}` → projeções e hints HTTP/WS | realtime-service, desk-web, worker, dashboard |
| C06 | Mídia / integração | Asset privado identifica bytes/owner, storage e estado de scan. Só CLEAN autorizado pode ser servido. PENDING/INFECTED/SCAN_FAILED não vira sucesso. Recovery é limitado, concorrente e progressivo; não prende todo o pool. | `{upload, ownerId, mime, size}` → `{assetId, scanStatus}`; download exige CLEAN | chat (anexos), media, worker, desk-web |
| C07 | Dados, migração e privacidade / dados | Schema/SQL/FK/índices/timezone concordam. Fresh e upgrade preservam registros e relações. Retenção/eliminação por cópia e replay de tombstone após restore seguem D02. Relação tutor–paciente segue D03 com compatibilidade. | migrações SQL e operações de dados → estado consistente verificável | database, todos os módulos, infra/scripts |
| C08 | UI e linguagem / design | Preservar identidade CVG e React/Vite. Componentes compartilham tokens/estados. Mobile/tablet são primeira classe. Loading/vazio/parcial/erro/sucesso/resultado incerto são diferentes. UUID/código interno não é obrigatório para trabalho comum. | props de componente + tokens → estados visuais distintos e acessíveis | desk-web (16 rotas) |
| C09 | Artefatos e observação / operação | Build/teste/scan/implantação referem o mesmo manifest digest por imagem. Todos runtimes têm configurações e readiness reais. CorrelationID une logs/spans/métricas sem PII. Restore verifica cada entidade, não a mera presença de uma tag. | Dockerfiles/Compose/CI → digests, readiness, spans, restore verificado | infra, CI, operação, SA-050–055 |
| C10 | Qualidade, nota e evidência / lead+crítico | Critério→teste→artefato→candidato→revisor rastreáveis. Gate estrutural de documento não aprova produto. Nota ≥95 exige evidência atual por item e confiança ALTA; autor não aprova a própria entrega. | AC + evidência → veredito de gate com revisor independente | BACKLOG.json, evidencias/, SA-059 |

## Exemplos obrigatórios (executáveis ou com referência precisa)

### 1. DTO usuário (C02, A01) — a implementar em SA-004
- **Row interna** (`modules/admin/src/infrastructure/repositories/admin.repository.ts:24`): `{ id, name, email, passwordHash, isActive, createdAt, updatedAt }`.
- **JSON público exigido**: `{ id, name, email, isActive, createdAt, updatedAt }` — nunca `passwordHash`.
- **Sucesso:** `GET /admin/users/:id` → 200 com o JSON acima. **Erro:** 404 `{error:'NOT_FOUND'}`; 401/403 sem sessão/permissão.
- **Consumidores:** `apps/desk-web/src/pages/Admin.tsx` (tabela/edição) toleram campos extras; a remoção é aditiva inversa (compatível).
- **Teste que distingue:** HTTP negativo em GET/POST/PUT verificando `!('passwordHash' in body)`.

### 2. Kanban (C01, A02/A03) — a implementar em SA-005
- **Sucesso:** `PATCH /kanban/card/:id/move {status:'em_atendimento'}` partindo de `finalizado` →
  `{statusV2:'em_atendimento', status:'open', isActive:true, closedAt:null, assignedUserId:<inalterado se não enviado>}` e um registro de histórico/audit/outbox no mesmo commit.
- **Erro/conflito:** versão esperada divergente → 409 sem sobrescrever responsável/setor de outro operador.
- **Demonstração:** teste HTTP autenticado + leitura direta no PostgreSQL descartável do runner (SA-003); reabertura não pode deixar `isActive=false`.
- **Política de reabertura (F6 da revisão M1):** `finalizado → em_atendimento` e `arquivado → em_atendimento` reabrem; ir direto para `novo` a partir de `finalizado`/`arquivado` responde **409 INVALID_STATUS_TRANSITION** — a rota aceita o enum completo, mas a transição é validada pelo caso de uso. Reabrir exige ação explícita de status (não é efeito colateral de filtro/lista).

### 3. Contexto (C04, A06) — a implementar em SA-008
- **Fixture:** conversa A com 2 tarefas/1 alerta/2 notas; conversa B com 1 tarefa/1 alerta/1 nota; registros sem vínculo.
- **Sucesso:** abrir `/tasks?conversationId=A` → requisição `GET /tasks?conversationId=A` → somente registros de A, com paginação; criar tarefa a partir da tela preenche `conversationId=A`; voltar à Inbox preserva A.
- **Análogos:** `/alerts?conversationId=A` e `/notes?conversationId=A` (não `mine=true` quando o contexto é a conversa).
- **Erro:** `conversationId` sem acesso → 403/404 sem vazar existência; id inválido → 400.

### 4. Eventos (C05) — referência atual
- `modules/transfers/src/application/use-cases/index.ts` cria `transfer.created/accepted/rejected` com `createEvent`, `persistOutboxEventIntent` e `publishRealtimeHintsAfterCommit`. **Consequências esperadas:** Inbox revalida lista/detalhe da conversa; Kanban move o card de coluna; KPIs de handoff são invalidados/recalculados. Se o hint for descartado, o fallback é o polling bounded do outbox (≤5s no cenário funcional) — nenhuma aprovação depende de hint efêmero.

### 5. Privacidade (C07, D02) — inventário honesto em SA-031
- **Presente em:** banco (messages/conversations/contacts/notes/tasks/alerts), objeto de mídia privado, logs com correlationId/PII redigida (`packages/shared/src/redact.ts`), backup PostgreSQL, subprocessador (Gateway/Secretary/IA quando habilitados).
- **Elimina:** dados por cópia com tombstone/rota de erasure; **retém** o mínimo legal com justificativa; **pseudonimiza** identificadores em logs; **solicita externamente** ao subprocessador quando aplicável.
- **Resposta ao titular:** exportação por escopo já implementada (`modules/privacy`), com limitação declarada quando dependente de terceiro.

### 6. Falhas (C01/C02/C04) — contrato tipado
| HTTP | Corpo | Retry? | Apresentação |
|---|---|---|---|
| 400 | `{error:'BAD_REQUEST', message}` | não | validação no campo |
| 401 | `{error:'UNAUTHORIZED'}` | após re-login | redireciona para Login preservando retorno |
| 403 | `{error:'FORBIDDEN'}` | não | acesso negado explícito, sem dados |
| 404 | `{error:'NOT_FOUND'}` | não | estado vazio honesto |
| 409 | `{error:'CONFLICT'}` | não automático | recarrega e mostra conflito; não sobrescreve |
| 429 | `{error:'RATE_LIMITED'}` | sim, com backoff | aviso de tentativa novamente |
| 500/503 | `{error:'INTERNAL_ERROR'\|'UNAVAILABLE'}` | 503 sim; 500 não automático | erro recuperável com ação de tentar novamente |
| timeout | `ApiRequestError.status=0` | sim, idempotente | resultado incerto explícito (nunca sucesso vazio) |

Implementação atual do cliente: `apps/desk-web/src/lib/api.ts` (`ApiRequestError` com `recoverable`/`retryable`). Nenhum erro interno pode ser convertido em sucesso vazio; toda mutação exibe o resultado real do servidor.

## Matriz de exemplos por contrato (SA-002/AC1)

Cada contrato tem ao menos um resultado de sucesso, um resultado de erro e um consumidor/produtor que deve fornecer a prova executável. Exemplos são contratos de comportamento; não são declaração de que o gate produtor já passou.

| ID | Exemplo de sucesso | Exemplo de erro/negação | Consumidor/prova responsável |
|---|---|---|---|
| C01 | `PATCH /kanban/card/:id/move` confirma estado, histórico, auditoria e outbox no mesmo commit. | Versão divergente retorna 409 sem sobrescrever setor/responsável. | SA-005; módulos chat/kanban |
| C02 | `GET /admin/users/:id` retorna somente DTO público para sessão autorizada. | Sem sessão/permissão retorna 401/403; recurso fora do escopo retorna 404 sem revelar existência. | SA-004/013; admin e realtime |
| C03 | Retry com a mesma `idempotencyKey` reconcilia o efeito existente e não duplica envio. | Aceite externo desconhecido pausa reenvio e exige reconciliação; não vira `completed` por conveniência. | SA-007/014/028; gateway e worker |
| C04 | `/tasks?conversationId=A` lista/cria somente registros autorizados de A e conserva o contexto no retorno. | ID inválido retorna 400; conversa sem acesso retorna 403/404 sem vazar dados. | SA-008; tasks/notes/alerts |
| C05 | Envelope versionado após commit invalida projeções necessárias e atualiza a UI dentro do orçamento. | Duplicata/ordem antiga é ignorada; hint perdido usa fallback bounded, nunca estado fictício. | SA-025/026/027; realtime e desk-web |
| C06 | Download de asset privado autorizado retorna bytes somente quando `scanStatus=CLEAN`. | `PENDING`, `INFECTED`, `SCAN_FAILED`, MIME/tamanho ou escopo inválido são negados. | SA-032/058; media e storage |
| C07 | Fresh/upgrade e restore preservam entidades, vínculos, FK, timezone e tombstones exigidos. | Migração/restore parcial ou vínculo ausente falha a verificação e não é promovido. | SA-020/021/024/031/055 |
| C08 | A mesma jornada apresenta loading, vazio, erro recuperável, sucesso e resultado incerto de forma acessível nos viewports congelados. | Dado longo, zoom ou teclado não pode esconder a ação principal nem obrigar UUID interno. | SA-033–049; desk-web |
| C09 | Build, scan, deploy, readiness e restore referenciam o mesmo digest de imagem e correlation ID sanitizado. | Digest divergente, readiness ausente ou restore que só confere uma tag reprova. | SA-050–055; CI/infra |
| C10 | AC → teste/procedimento → artefato hash → candidato → crítico independente produz trilha atual. | Evidência stale, hash divergente, skip requerido ou autor como revisor produz FAIL/INVALID. | SA-002/050/059; backlog/evidências |

## Denominadores congelados (QB-1)

Ver `CRITERIOS.md` § “Denominadores congelados (QB-1)” e a cópia legível por máquina em `evidencias/SA-002/frozen-denominators.json`. Nenhum denominador pode ser reduzido após falha; exclusões só com motivo legítimo registrado **antes** da medição.

## Mudança de contrato

O dono registra versão, motivo, consumidores, migração, compatibilidade e teste. Antes de paralelizar, backend e frontend concordam em exemplos executáveis; publicar tipo compartilhado sem endpoint correspondente não conclui o contrato. Uma mudança invalida a prova dos consumidores afetados e reabre o backlog correspondente. A versão vigente é **C-1**; qualquer alteração deve constar no registro de execução (`EXECUCAO.md`) com a tarefa que a motivou.
