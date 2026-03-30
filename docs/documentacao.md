# CVG CONNECT DESK — DOCUMENTAÇÃO ENTERPRISE COMPLETA

## 1. VISÃO GERAL DO PRODUTO

### 1.1 Nome do Produto

CVG Connect Desk

### 1.2 Descrição

Plataforma proprietária de atendimento, operação e relacionamento para hospital veterinário, construída sobre infraestrutura existente (gateway + Agent Secretary + Evolution API), com foco em:

* Conversação omnichannel (inicialmente WhatsApp)
* Operação interna (tarefas, notas, alertas)
* Gestão (dashboard, auditoria, administração)
* Integração hospitalar (tutor, paciente, HIS)
* Automação com IA (Agent Secretary)

### 1.3 Objetivo

Criar um sistema central que substitui a interface do Chatwoot e evolui para:

* Hub de atendimento
* CRM hospitalar
* Sistema operacional de relacionamento
* Plataforma de inteligência e automação

---

## 2. PRINCÍPIOS ARQUITETURAIS

### 2.1 Arquitetura adotada

* Arquitetura modular por domínio
* Event-driven (baseado em eventos)
* Ports & Adapters (Hexagonal)
* Baixo acoplamento com gateway e canais ([Wikipedia][1])

### 2.2 Diretrizes

* NÃO alterar o gateway existente
* NÃO quebrar integração com Agent Secretary
* COMPATIBILIDADE com contratos atuais (Chatwoot-like)
* EVOLUÇÃO incremental (sem downtime)
* DADOS centralizados no novo sistema

---

## 3. ARQUITETURA GERAL

### 3.1 Fluxo principal

WhatsApp
↓
Evolution API
↓
Gateway existente
↓
CVG Connect Desk (novo sistema)
↓
Agent Secretary (IA)
↓
Resposta ao cliente

### 3.2 Componentes

* channel layer (Evolution API)
* gateway (existente)
* desk-api (novo)
* desk-web (frontend)
* message-worker
* ai-orchestrator
* secretary-adapter
* realtime service

### 3.3 Padrão de mensageria

* Webhook inbound
* Fila (Redis/BullMQ)
* Processamento assíncrono
* Entrega em tempo real via WebSocket ([DEV Community][2])

---

## 4. MÓDULOS DO SISTEMA

---

## 4.1 CHAT (CORE)

Responsável por conversas.

### Entidades:

* conversations
* messages
* participants
* attachments
* assignments
* tags
* conversation_status

### Features:

* inbox em tempo real
* envio/recebimento
* handoff bot/humano
* histórico completo
* multi-atendente

---

## 4.2 TASKS

### Entidades:

* tasks
* task_status
* task_priority
* task_assignee
* task_due_date

### Features:

* criação via conversa
* vinculação com tutor/paciente
* lembretes
* SLA operacional

---

## 4.3 NOTES

### Entidades:

* internal_notes
* note_author
* note_reference

### Features:

* notas internas
* vínculo com:

  * conversa
  * tutor
  * paciente
  * tarefa

---

## 4.4 ALERTS

### Entidades:

* alerts
* alert_rules
* alert_events

### Exemplos:

* conversa sem resposta
* tarefa vencida
* cliente VIP aguardando
* urgência clínica
* erro de envio

---

## 4.5 ADMIN

### Entidades:

* users
* roles
* permissions
* queues
* teams
* macros
* automation_rules

### Features:

* controle de acesso
* filas de atendimento
* automações
* configurações

---

## 4.6 AUDIT

### Entidades:

* audit_logs

### Registrar:

* mensagens enviadas
* mudança de status
* handoff bot/humano
* criação de tarefas
* alterações administrativas

---

## 4.7 DASHBOARD

### Tipos:

#### Operacional

* tempo de resposta
* filas
* backlog

#### IA

* taxa de resolução
* fallback
* handoff

#### Comercial

* leads
* conversão
* origem

#### Gerencial

* produtividade
* SLA
* volume

---

## 4.8 CAMADA HOSPITALAR

### Entidades:

* tutors
* patients
* relationships

### Features:

* identificação automática por telefone
* histórico clínico resumido
* integração futura com HIS

---

## 5. INTEGRAÇÃO COM SISTEMAS EXISTENTES

---

## 5.1 Gateway

Reutilizar:

* webhooks
* envio de mensagens
* autenticação
* logs

NÃO alterar estrutura base.

---

## 5.2 Agent Secretary

### Manter compatibilidade:

* labels
* estados de conversa
* handoff
* estrutura de eventos

### Criar:

* secretary-adapter

---

## 5.3 Evolution API

Usar como:

* conector de canal
* envio/recebimento

---

## 6. MODELO DE DADOS (RESUMO)

### Principais tabelas:

* conversations
* messages
* contacts
* tutors
* patients
* tasks
* notes
* alerts
* users
* audit_logs
* conversation_tags
* conversation_assignments

---

## 7. FRONTEND (DESK)

---

## 7.1 Layout

### 3 colunas:

1. Lista de conversas
2. Chat
3. Painel lateral

---

## 7.2 Painel lateral

* tutor
* paciente
* tarefas
* notas
* alertas
* resumo IA

---

## 8. BACKEND

---

## 8.1 Serviços

* desk-api
* message-worker
* realtime-service
* secretary-adapter

---

## 8.2 Stack

* Node.js
* TypeScript
* Fastify
* PostgreSQL
* Redis
* BullMQ

---

## 9. ROADMAP DE IMPLEMENTAÇÃO

---

## FASE 1 — CORE

* inbox
* mensagens
* integração gateway
* envio/recebimento

---

## FASE 2 — OPERAÇÃO

* tarefas
* notas
* alertas
* painel lateral

---

## FASE 3 — ADMIN

* usuários
* permissões
* filas
* auditoria

---

## FASE 4 — DASHBOARD

* KPIs
* relatórios

---

## FASE 5 — CRM/HOSPITAL

* tutor
* paciente
* integração HIS

---

## 10. RISCOS

* duplicação de mensagens
* quebra de compatibilidade com Secretary
* falta de idempotência
* mistura de lógica clínica/comercial

---

## 11. DECISÕES CRÍTICAS

* gateway NÃO será alterado
* Secretary NÃO será reescrita
* sistema será compatível com Chatwoot-like
* evolução incremental

---

## 12. RESULTADO FINAL ESPERADO

Sistema proprietário que substitui Chatwoot e evolui para:

* atendimento
* CRM
* automação
* inteligência
* gestão operacional

---

## 13. RESUMO EXECUTIVO

O CVG Connect Desk será o núcleo digital do hospital, integrando comunicação, operação, inteligência e gestão em uma única plataforma modular e escalável.

---

[1]: https://en.wikipedia.org/wiki/Hexagonal_architecture_%28software%29?utm_source=chatgpt.com "Hexagonal architecture (software)"
[2]: https://dev.to/sgchris/building-a-chat-system-like-whatsapp-real-time-at-scale-1o2g?utm_source=chatgpt.com "Building a Chat System Like WhatsApp: Real-time at Scale"
