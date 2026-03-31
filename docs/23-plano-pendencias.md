# Plano de Implementação — Pendências CVG Connect Desk

**Data:** 31/03/2026
**Responsável:** Engenharia
**Status:** Aprovado para execução

---

## Visão Geral

6 pendências identificadas no relatório de auditoria (docs vs implementação). Priorizadas por impacto na operação e risco em produção.

| # | Item | Prioridade | Estimativa | Dependências |
|---|------|-----------|------------|--------------|
| 1 | Corrigir Docker build | 🔴 Crítica | 1h | Nenhuma |
| 2 | Testes unitários e integração | 🔴 Crítica | 8-12h | #1 |
| 3 | Conectar Realtime ao frontend | 🟡 Alta | 4-6h | Nenhuma |
| 4 | Ativar Secretary no fluxo inbound | 🟡 Alta | 3-4h | Nenhuma |
| 5 | CRUD Tutor/Patient | 🟢 Média | 4-6h | Nenhuma |
| 6 | Atualizar documentação | 🟢 Média | 2-3h | Todos anteriores |

**Tempo total estimado:** 22-32 horas

---

## Fase 1 — Corrigir Docker Build (Produção)

### Problema
O build Docker do `desk-web` falha por causa do `rollup@4.60.x` que tenta carregar um binary nativo (`@rollup/rollup-linux-x64-musl`) mas não encontra. O `ROLLUP_DISABLE_NATIVE=1` não é respeitado nessa versão.

### Solução
Downgrade do rollup para versão estável ou pinnar o optional dependency corretamente.

### Tarefas

#### 1.1 — Fix rollup no desk-web
- [ ] Atualizar `apps/desk-web/package.json` para usar `rollup@4.14.x` (última versão estável sem native binary issue)
- [ ] Ou adicionar `@rollup/rollup-linux-x64-musl` como dependency no workspace root
- [ ] Atualizar `pnpm-lock.yaml`
- [ ] Testar: `docker compose build desk-web`

#### 1.2 — Fix Dockerfile desk-api
- [ ] Verificar se desk-api builda corretamente
- [ ] Se necessário, aplicar mesmo fix de rollup

#### 1.3 — Validar docker-compose completo
- [ ] `docker compose build` (todos os serviços)
- [ ] `docker compose up -d`
- [ ] Verificar health de todos os containers
- [ ] Testar acesso via `http://localhost:8081`

#### 1.4 — Variáveis de ambiente
- [ ] Criar `.env.production` com valores corretos
- [ ] Documentar variáveis obrigatórias vs opcionais
- [ ] Validar que `CORS_ORIGIN`, `DATABASE_URL`, `REDIS_URL` funcionam

**Critério de saída:** `docker compose build && docker compose up -d` funciona sem erros em máquina limpa.

---

## Fase 2 — Testes (Crítico)

### Problema
Vitest está configurado mas existem 0 testes. Sem safety net para refactors, deploy é arriscado.

### Estratégia
Priorizar testes nos use cases (lógica de negócio) e nos controllers (integração). Testes de UI ficam para depois.

### Tarefas

#### 2.1 — Setup de testes
- [ ] Verificar `vitest.config.ts` está correto
- [ ] Criar pasta `__tests__` em cada módulo ou usar `*.spec.ts` ao lado dos fontes
- [ ] Criar helper de teste: mock do DB, mock do publisher, factory de entidades
- [ ] Criar `packages/test-utils` com helpers compartilhados

#### 2.2 — Testes do módulo Chat (prioritário)
- [ ] `receiveInboundMessage` — cria conversa nova, idempotência por externalMessageId
- [ ] `sendOutboundMessage` — validação de recipient, conversa fechada
- [ ] `createConversation` — criação básica com histórico
- [ ] `conversation.repository` — CRUD, findAll com filtros, updateStatusV2
- [ ] `message.repository` — create, findByConversationId, findRecent
- [ ] Controller: `POST /webhook/inbound` — sucesso, duplicado, erro
- [ ] Controller: `POST /messages` — sucesso, sem auth, conversa fechada
- [ ] Controller: `GET /conversations` — lista, filtro por sectorId
- [ ] Controller: `PATCH /conversations/:id/status` — transições válidas
- [ ] Controller: `POST /conversations/:id/transfer` — transferência

#### 2.3 — Testes do módulo Tasks
- [ ] `createTask` — criação com vínculo a conversa
- [ ] `updateTaskStatus` — transições de status
- [ ] Controller: CRUD básico

#### 2.4 — Testes do módulo Contacts
- [ ] `createContact` — duplicata por telefone
- [ ] `startConversation` — conversa existente vs nova
- [ ] Controller: CRUD básico

#### 2.5 — Testes do módulo Auth
- [ ] Login — sucesso, senha errada, usuário inexistente
- [ ] Token JWT — válido, expirado, malformado
- [ ] RBAC — permissão correta, sem permissão

#### 2.6 — Testes de integração (API completa)
- [ ] Health/readiness endpoints
- [ ] Fluxo completo: login → criar contato → iniciar conversa → enviar mensagem
- [ ] Fluxo: criar task → atualizar status → completar

#### 2.7 — CI/CD
- [ ] Adicionar step de testes no `package.json` scripts
- [ ] Configurar `pnpm test` como comando global
- [ ] (Opcional) GitHub Actions para rodar testes no push

**Critério de saída:** `pnpm test` passa com cobertura mínima de 60% nos use cases.

---

## Fase 3 — Conectar Realtime ao Frontend

### Problema
O `realtime-service` (WebSocket) está implementado mas o frontend não se conecta. O Inbox faz polling a cada 8-10s, o que gera latência e carga desnecessária.

### Tarefas

#### 3.1 — Verificar realtime-service
- [ ] Ler código de `apps/realtime-service/src/`
- [ ] Documentar eventos suportados: tipos, payload, canais
- [ ] Verificar autenticação WebSocket (token via query param)
- [ ] Testar conexão manual: `wscat -c ws://localhost:8080?token=xxx`

#### 3.2 — Integrar no Inbox
- [ ] Conectar `realtimeClient` no `useEffect` do Inbox após login
- [ ] Subscrever ao canal da conversa selecionada
- [ ] Ouvir evento `message.new` → adicionar mensagem à lista sem reload
- [ ] Ouvir evento `conversation.updated` → atualizar sidebar (status, lastMessage)
- [ ] Ouvir evento `conversation.created` → adicionar conversa à lista
- [ ] Remover polling de 8s quando WebSocket está conectado
- [ ] Manter polling como fallback se WebSocket desconectar

#### 3.3 — Indicadores de conexão
- [ ] Badge "Conectado" / "Desconectado" no header do Inbox
- [ ] Toast de reconexão automática
- [ ] Exibir "digitando..." quando aplicável

#### 3.4 — Outras páginas
- [ ] Kanban — atualizar cards em tempo real
- [ ] Dashboard — atualizar métricas em tempo real
- [ ] Alerts — notificação de novo alerta

**Critério de saída:** Nova mensagem aparece no Inbox em <1s sem refresh da página.

---

## Fase 4 — Ativar Secretary no Fluxo Inbound

### Problema
O `processMessageWithSecretary` existe como use case mas não é chamado quando uma mensagem inbound chega via webhook. A automação de IA não funciona.

### Tarefas

#### 4.1 — Verificar integração atual
- [ ] Ler `modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts`
- [ ] Confirmar que a chamada para Secretary está comentada ou ausente
- [ ] Ler `modules/secretary-adapter/src/` — verificar contratos e métodos disponíveis
- [ ] Verificar `SECRETARY_URL` e `SECRETARY_API_KEY` no `.env`

#### 4.2 — Ativar chamada no inbound
- [ ] Descomentar/ativar `processMessageWithSecretary` no `receiveInboundMessage`
- [ ] Garantir que erro na Secretary não quebra o fluxo de inbound (try/catch)
- [ ] Registrar log estruturado quando Secretary responde
- [ ] Registrar log de warning quando Secretary falha

#### 4.3 — Handoff bot → human
- [ ] Quando Secretary indicar handoff: atualizar `currentHandler` para `human`
- [ ] Publicar evento `conversation.handoff`
- [ ] Atualizar status da conversa se necessário

#### 4.4 — Resposta automática da Secretary
- [ ] Se Secretary retornar resposta para o cliente, enviar via `sendOutboundMessage`
- [ ] Registrar mensagem no banco como outbound com `senderType: 'bot'`
- [ ] Publicar evento para realtime

#### 4.5 — Testes
- [ ] Testar fluxo completo: inbound → Secretary → resposta automática
- [ ] Testar handoff: inbound → Secretary → handoff → atendente humano
- [ ] Testar fallback: Secretary offline → mensagem persistida normalmente

**Critério de saída:** Mensagem inbound ativa consulta à Secretary e resposta automática quando aplicável.

---

## Fase 5 — CRUD Tutor/Patient

### Problema
As tabelas `tutors` e `patients` existem no schema mas não há controllers ou rotas para gerenciá-los. O fluxo clínico fica incompleto.

### Tarefas

#### 5.1 — Módulo Tutors
- [ ] Criar `modules/tutors/` com estrutura padrão (use-cases, repository, controller)
- [ ] Repository: CRUD completo (create, findById, findAll, update, delete)
- [ ] Use cases: createTutor, updateTutor, getTutor, listTutors, deleteTutor
- [ ] Controller: rotas RESTful
  - `GET /tutors` — listar (com busca por nome/telefone)
  - `GET /tutors/:id` — detalhes (com patients vinculados)
  - `POST /tutors` — criar
  - `PUT /tutors/:id` — atualizar
  - `DELETE /tutors/:id` — deletar
- [ ] Registrar rotas em `apps/desk-api/src/index.ts`
- [ ] Adicionar RBAC: `tutors:read`, `tutors:write`

#### 5.2 — Módulo Patients
- [ ] Criar `modules/patients/` com estrutura padrão
- [ ] Repository: CRUD completo (create, findById, findAll, update, delete)
- [ ] Filtros: por tutor, por espécie, por raça
- [ ] Use cases: createPatient, updatePatient, getPatient, listPatients, deletePatient
- [ ] Controller: rotas RESTful
  - `GET /patients` — listar (com filtros: tutorId, species)
  - `GET /patients/:id` — detalhes (com tutor e conversas)
  - `POST /patients` — criar (vincular tutor)
  - `PUT /patients/:id` — atualizar
  - `DELETE /patients/:id` — deletar
- [ ] Registrar rotas em `apps/desk-api/src/index.ts`
- [ ] Adicionar RBAC: `patients:read`, `patients:write`

#### 5.3 — Vínculos
- [ ] Contato pode ter tutorId e patientId (já no schema)
- [ ] Task pode ter tutorId e patientId (já no schema)
- [ ] Ao criar contato, opção de vincular a tutor existente
- [ ] Ao criar task, opção de vincular a patient

#### 5.4 — Frontend
- [ ] Criar página `Tutors.tsx` — lista com busca, formulário de criação/edição
- [ ] Criar página `Patients.tsx` — lista com filtros, formulário de criação/edição
- [ ] Adicionar links na sidebar: 👨‍👩‍👦 Tutores, 🐾 Pacientes
- [ ] Na página de contato, exibir tutor/patient vinculados

**Critério de saída:** CRUD completo de Tutors e Patients funcionando via API e UI.

---

## Fase 6 — Atualizar Documentação

### Problema
Vários docs estão desatualizados: Phase 9 marcada como "NÃO implementar" mas já tem código, rate limiting documentado como pendente mas já existe, etc.

### Tarefas

#### 6.1 — Atualizar `14-roadmap.md`
- [ ] Phase 8: detalhar tarefas restantes (Docker, testes, deploy)
- [ ] Phase 9: mudar status para "IMPLEMENTADO" com resumo do que foi feito
- [ ] Adicionar Phase 10 se necessário (Tutor/Patient, Realtime frontend)

#### 6.2 — Atualizar `15-implementation-phases.md`
- [ ] Atualizar status das fases conforme implementação real
- [ ] Marcar Realtime como "Backend OK, Frontend pendente"
- [ ] Adicionar subtarefas de testes

#### 6.3 — Atualizar `22-enterprise-premium-plan.md`
- [ ] Marcar itens implementados com ✅
- [ ] Documentar o que ainda falta do plano Enterprise

#### 6.4 — Atualizar `AUDITORIA_IMPLEMENTACAO.md`
- [ ] Re-executar auditoria após correções
- [ ] Atualizar tabela de status por módulo
- [ ] Remover itens que foram corrigidos

#### 6.5 — Atualizar `20-master-execution-log.md`
- [ ] Adicionar entradas para: Inbox rewrite (31/03), novos endpoints
- [ ] Adicionar entradas para cada fase deste plano à medida que for concluída

#### 6.6 — Criar `23-test-strategy.md` (novo)
- [ ] Documentar estratégia de testes adotada
- [ ] Listar cobertura por módulo
- [ ] Documentar como rodar testes

#### 6.7 — Criar `24-deployment-guide.md` (novo)
- [ ] Passo a passo de deploy em produção
- [ ] Variáveis de ambiente obrigatórias
- [ ] Health checks e monitoramento
- [ ] Rollback procedure

**Critência de saída:** `grep -r "NÃO implementar\|pendente\|não existe" docs/` retorna 0 itens que já foram implementados.

---

## Cronograma Sugerido

| Dia | Fase | Entregável |
|-----|------|------------|
| **Dia 1** | Fase 1 (Docker) + Fase 2 início | Docker build funcionando, testes de Chat prontos |
| **Dia 2** | Fase 2 continuação | Testes de Tasks, Contacts, Auth |
| **Dia 3** | Fase 2 conclusão + Fase 3 início | Testes integração, Realtime no Inbox |
| **Dia 4** | Fase 3 + Fase 4 | Realtime completo, Secretary ativada |
| **Dia 5** | Fase 5 | CRUD Tutor/Patient (API + Frontend) |
| **Dia 6** | Fase 6 | Documentação atualizada, revisão final |

---

## Regras de Execução

1. **Uma fase por vez** — não pular para a próxima até a atual estar validada
2. **Testar antes de commitar** — cada fase tem critério de saída verificável
3. **Commits pequenos** — um commit por tarefa concluída
4. **Não quebrar o que funciona** — se algo não pode ser feito sem risco, pular e documentar
5. **Atualizar este plano** — se estimativas mudarem, ajustar aqui

---

## Referências

- [Relatório Auditoria](./docs/AUDITORIA_IMPLEMENTACAO.md)
- [Roadmap](./docs/14-roadmap.md)
- [Implementation Phases](./docs/15-implementation-phases.md)
- [Enterprise Premium Plan](./docs/22-enterprise-premium-plan.md)
- [Master Execution Log](./docs/20-master-execution-log.md)
