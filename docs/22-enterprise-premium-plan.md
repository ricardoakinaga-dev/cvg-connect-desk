# CVG Connect Desk — Plano Enterprise Premium (Fase 9)

**Data:** 2026-03-30
**Status:** ✅ IMPLEMENTADO (31/03/2026)
**Referência:** Chatwoot (open-source), KanbanWoot, padrões enterprise de helpdesk

---

## 1. Resumo Executivo

O objetivo desta fase é transformar o CVG Connect Desk de um sistema operacional básico em uma **plataforma premium de atendimento digital** com experiência Chatwoot-like, incluindo:

- **Inbox multi-setorial** com departamentos organizados
- **Labels/tags** ilimitadas com cores e filtros
- **Grupos de contatos** (internos, externos, mistos)
- **Transferência de contatos** entre setores
- **Dashboard Kanban** com trilhas de atendimento
- **Cards dinâmicos** por contexto (Clínica, Internação, Leads, etc.)
- **Status granulares** por conversa (Novo, Atendido, Pendente, Espera, Finalizado)

---

## 2. Análise do Estado Atual vs Alvo

### 2.1 O Que Já Existe

| Componente | Estado Atual | Precisa Mudar |
|-----------|-------------|---------------|
| Conversas | ✅ Funcional | Adicionar status granulares e setor |
| Mensagens | ✅ Funcional | OK |
| Contatos (tutor/patient) | ✅ Básico | Expandir para grupos e categorias |
| Filas (queues) | ✅ CRUD básico | Virar "Setores" com inbox próprio |
| Times (teams) | ✅ CRUD básico | Associar a setores |
| Labels | ❌ Só no chat | Sistema global de labels |
| Kanban | ❌ Não existe | Dashboard completo |
| Grupos de contatos | ❌ Não existe | Sistema de grupos |
| Transferência | ❌ Não existe | Fluxo de transferência |
| Status granulares | ❌ Só open/pending/closed | Novos status operacionais |

### 2.2 Referência Chatwoot — Conceitos a Adotar

```
Chatwoot          → CVG Connect Desk
─────────────────────────────────────
Account           → Hospital (single-tenant)
Inbox             → Setor (Recepção, Clínica, Internação, etc.)
Channel           → WhatsApp (mantém único por enquanto)
Contact           → Tutor/Paciente/Colaborador
ContactInbox      → ContatoSetor (vínculo contato↔setor)
Conversation      → Conversa (com status granular)
Team              → Time (grupo de colaboradores)
Label             → Label (tag global com cor)
Automation        → Regra de automação (futuro)
Custom Attributes → Campos customizados (futuro)
```

---

## 3. Domínios e Modelos de Dados

### 3.1 Setores (Inboxes)

O conceito de "fila" (queue) evolui para **Setor** — um departamento operacional com inbox próprio.

**Setores padrão sugeridos para hospital veterinário:**

| Setor | Código | Descrição |
|-------|--------|-----------|
| Recepção | `recepcao` | Primeiro atendimento, agendamentos, dúvidas |
| Clínica Médica | `clinica` | Consultas, exames, resultados |
| Internação | `internacao` | Pacientes internados, atualização de status |
| Cirurgia | `cirurgia` | Agendamento e acompanhamento cirúrgico |
| Comercial | `comercial` | Orçamentos, pacotes, vacinas |
| Farmácia | `farmacia` | Medicamentos, dispensação |
| Administrativo | `admin` | Cobrança, documentos, reclamações |

**Tabela: `sectors`**

```sql
CREATE TABLE sectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  color VARCHAR(7) DEFAULT '#4361ee',       -- cor do setor (hex)
  icon VARCHAR(10) DEFAULT '📋',            -- emoji do setor
  is_active BOOLEAN DEFAULT true,
  auto_assign BOOLEAN DEFAULT false,        -- atribuição automática
  max_concurrent INTEGER DEFAULT 0,         -- 0 = sem limite
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.2 Labels (Tags Globais)

Labels são categorias visuais que podem ser aplicadas a **conversas** e **contatos**.

**Labels padrão sugeridas:**

| Label | Cor | Categoria |
|-------|-----|-----------|
| `urgente` | 🔴 #ef4444 | Prioridade |
| `agendamento` | 🔵 #3b82f6 | Tipo |
| `duvida` | 🟡 #eab308 | Tipo |
| `orcamento` | 🟢 #22c55e | Tipo |
| `retorno` | 🟣 #a855f7 | Tipo |
| `vacinacao` | 🟠 #f97316 | Serviço |
| `exame` | 🔵 #06b6d4 | Serviço |
| `internacao` | 🔴 #dc2626 | Serviço |
| `cirurgia` | 🔴 #b91c1c | Serviço |
| `vip` | ⭐ #fbbf24 | Status |
| `inadimplente` | 🔴 #991b1b | Financeiro |
| `primeira-vez` | 🟢 #16a34a | Tipo |

**Tabela: `labels`**

```sql
CREATE TABLE labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#6b7280',
  description TEXT,
  category VARCHAR(50),                    -- 'prioridade', 'tipo', 'serviço', etc.
  is_system BOOLEAN DEFAULT false,         -- labels do sistema não podem ser deletadas
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name)
);
```

**Tabela: `conversation_labels`**

```sql
CREATE TABLE conversation_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(conversation_id, label_id)
);
```

**Tabela: `contact_labels`**

```sql
CREATE TABLE contact_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(contact_id, label_id)
);
```

### 3.3 Grupos de Contatos

Grupos permitem organizar contatos em coleções para facilitar busca, campanhas e visualização.

**Tipos de grupo:**

| Tipo | Descrição | Exemplo |
|------|-----------|---------|
| `internal` | Contatos internos (colaboradores) | Veterinários, recepcionistas |
| `external` | Contatos externos (tutores/clientes) | Tutores de pacientes |
| `mixed` | Contatos internos + externos | Equipe do plantão |
| `sector` | Contatos vinculados a um setor | Tutores da Clínica |
| `custom` | Grupo criado manualmente | "Tutores VIP" |

**Tabela: `contact_groups`**

```sql
CREATE TABLE contact_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(150) NOT NULL,
  description TEXT,
  group_type VARCHAR(20) NOT NULL DEFAULT 'custom',
    -- 'internal', 'external', 'mixed', 'sector', 'custom'
  sector_id UUID REFERENCES sectors(id),    -- se group_type = 'sector'
  color VARCHAR(7) DEFAULT '#6b7280',
  icon VARCHAR(10) DEFAULT '👥',
  is_system BOOLEAN DEFAULT false,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Tabela: `contact_group_members`**

```sql
CREATE TABLE contact_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES contact_groups(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  added_by UUID REFERENCES users(id),
  added_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, contact_id)
);
```

### 3.4 Contato-Setor (ContactInbox)

Vínculo entre contato e setor — um mesmo contato pode estar em múltiplos setores.

**Tabela: `contact_sectors`**

```sql
CREATE TABLE contact_sectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  sector_id UUID NOT NULL REFERENCES sectors(id),
  source_id VARCHAR(255),                   -- identificador externo (ex: WhatsApp)
  status VARCHAR(20) DEFAULT 'active',      -- active, transferred, archived
  assigned_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(contact_id, sector_id)
);
```

### 3.5 Status Granulares de Conversa

**Status atual → Novo status:**

| Status Atual | Novo Status | Descrição |
|-------------|-------------|-----------|
| `open` | `novo` | Conversa recém-criada, sem atendimento |
| `open` | `em_atendimento` | Sendo atendida por um agente |
| `pending` | `pendente` | Aguardando resposta do tutor |
| `pending` | `em_espera` | Na fila de espera do setor |
| `closed` | `finalizado` | Atendimento concluído |
| `archived` | `arquivado` | Movido para arquivo |

**Enum: `conversation_status_v2`**

```sql
CREATE TYPE conversation_status_v2 AS ENUM (
  'novo',
  'em_atendimento',
  'pendente',
  'em_espera',
  'finalizado',
  'arquivado'
);
```

### 3.6 Transferência de Contato entre Setores

**Tabela: `contact_transfers`**

```sql
CREATE TABLE contact_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  conversation_id UUID REFERENCES conversations(id),
  from_sector_id UUID REFERENCES sectors(id),
  to_sector_id UUID NOT NULL REFERENCES sectors(id),
  from_user_id UUID REFERENCES users(id),
  to_user_id UUID REFERENCES users(id),
  reason TEXT,
  status VARCHAR(20) DEFAULT 'pending',     -- pending, accepted, rejected
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
```

---

## 4. Dashboard Kanban

### 4.1 Conceito

O Kanban é um dashboard visual com **trilhas verticais** (colunas) representando status de atendimento, e **cards** representando conversas/contatos em cada status.

### 4.2 Trilhas Padrão

```
┌─────────────┬──────────────┬──────────┬────────────┬────────────┐
│    NOVO     │ EM ATENDIMENTO │ PENDENTE │ EM ESPERA  │ FINALIZADO │
├─────────────┼──────────────┼──────────┼────────────┼────────────┤
│ 🟢 Card 1   │ 🔵 Card 4    │ 🟡 Card 7│ ⏳ Card 10 │ ✅ Card 13 │
│ 🟢 Card 2   │ 🔵 Card 5    │ 🟡 Card 8│ ⏳ Card 11 │ ✅ Card 14 │
│ 🟢 Card 3   │ 🔵 Card 6    │ 🟡 Card 9│ ⏳ Card 12 │ ✅ Card 15 │
└─────────────┴──────────────┴──────────┴────────────┴────────────┘
```

### 4.3 Cards Dinâmicos

Cada card no Kanban mostra:

```
┌──────────────────────────────┐
│ 🔴 Urgente          🏷️ Label │
│                              │
│ 👤 João Silva                │
│ 📱 +55 11 99999-0000         │
│ 🐕 Rex (Golden Retriever)    │
│                              │
│ 💬 "Gostaria de agendar..."  │
│                              │
│ 👩‍⚕️ Dra. Maria    🕐 5min    │
│ 📋 Recepção                  │
└──────────────────────────────┘
```

**Campos do card:**
- Nome do tutor
- Telefone
- Nome do paciente (animal)
- Última mensagem (preview)
- Agente responsável
- Tempo desde última atividade
- Setor atual
- Labels aplicadas
- Prioridade (cor da borda)

### 4.4 Filtros do Kanban

O Kanban deve ser filtrável por:

- **Setor** — mostrar apenas conversas de um setor
- **Agente** — mostrar apenas conversas atribuídas a um agente
- **Labels** — mostrar apenas conversas com determinadas labels
- **Prioridade** — filtrar por urgente, alta, normal, baixa
- **Período** — hoje, última semana, último mês
- **Grupo de contatos** — filtrar por grupo

### 4.5 Personalização

- Usuário pode criar **trilhas customizadas** (ex: "Clínica Médica", "Internação")
- Cards podem ser **arrastados** entre trilhas para mudar status
- Cada trilha pode ter uma **cor** e **ícone** próprios

### 4.6 Trilhas por Contexto

Além das trilhas de status, o Kanban pode ser organizado por contexto:

**Trilha "Tutores (Clientes do Hospital)":**
```
┌────────────┬────────────┬───────────┬────────────┐
│   NOVOS    │ ATENDIDOS  │ PENDENTES │ FINALIZADOS│
├────────────┼────────────┼───────────┼────────────┤
│ Tutor A    │ Tutor D    │ Tutor G   │ Tutor J    │
│ Tutor B    │ Tutor E    │ Tutor H   │ Tutor K    │
│ Tutor C    │ Tutor F    │ Tutor I   │ Tutor L    │
└────────────┴────────────┴───────────┴────────────┘
```

**Trilha "Leads (Agendamento/Dúvidas)":**
```
┌────────────┬────────────┬───────────┬────────────┐
│  NOVOS     │ CONTATADOS │ QUALIFICADOS│ CONVERTIDOS│
├────────────┼────────────┼───────────┼────────────┤
│ Lead 1     │ Lead 4     │ Lead 7    │ Lead 10    │
│ Lead 2     │ Lead 5     │ Lead 8    │ Lead 11    │
│ Lead 3     │ Lead 6     │ Lead 9    │ Lead 12    │
└────────────┴────────────┴───────────┴────────────┘
```

**Trilha "Colaboradores":**
```
┌────────────┬────────────┬───────────┬────────────┐
│  NOVOS     │ EM ANDAMENTO│ PENDENTES│ FINALIZADOS│
├────────────┼────────────┼───────────┼────────────┤
│ Tarefa 1   │ Tarefa 4   │ Tarefa 7  │ Tarefa 10  │
│ Tarefa 2   │ Tarefa 5   │ Tarefa 8  │ Tarefa 11  │
│ Tarefa 3   │ Tarefa 6   │ Tarefa 9  │ Tarefa 12  │
└────────────┴────────────┴───────────┴────────────┘
```

---

## 5. Transferência de Contatos entre Setores

### 5.1 Fluxo

```
1. Atendente da Recepção identifica que tutor precisa ir para Clínica
2. Clica "Transferir" na conversa
3. Seleciona setor destino: "Clínica Médica"
4. Opcionalmente seleciona agente destino
5. Adiciona motivo/observação
6. Confirma transferência
7. Sistema:
   a. Cria registro em contact_transfers
   b. Atualiza contact_sectors (setor destino)
   c. Move conversa para novo setor
   d. Notifica agente destino via realtime
   e. Adiciona nota interna automática
   f. Publica evento contact.transferred
```

### 5.2 Regras

- Transferência pode ser **direta** (imediatamente aceita) ou **pendente** (agente destino precisa aceitar)
- Transferência é auditada automaticamente
- Histórico de transferências é visível no painel do contato
- Transferência preserva histórico de mensagens

---

## 6. Layout Premium — Chatwoot-like

### 6.1 Sidebar

```
┌─────────────────────┐
│ 🐾 CVG Desk         │
├─────────────────────┤
│                     │
│ OPERAÇÃO            │
│ 📥 Inbox            │
│ 📋 Kanban           │
│ 👥 Contatos         │
│ 💬 Conversas        │
│                     │
│ SETORES             │
│ 🏥 Recepção (3)     │
│ 🩺 Clínica (5)      │
│ 🏨 Internação (2)   │
│ 💊 Farmácia (0)     │
│ ⚙️ Config. Setores  │
│                     │
│ GESTÃO              │
│ 📊 Dashboard        │
│ 🏷️ Labels           │
│ 👥 Grupos           │
│ ⚙️ Administração    │
│ 🔍 Auditoria        │
│                     │
│─────────────────────│
│ 👤 Ricardo A.       │
│ ⚙️ Configurações    │
│ 🚪 Sair             │
└─────────────────────┘
```

### 6.2 Inbox — 3 Colunas (Refinada)

```
┌──────────────┬────────────────────────────┬─────────────────┐
│ COLUNA 1     │ COLUNA 2                   │ COLUNA 3        │
│              │                            │                 │
│ 🔍 Buscar... │ 👤 João Silva              │ 📋 Informações  │
│              │ 📱 +55 11 99999-0000       │                 │
│ Filtros:     │ 🏷️ urgente, agendamento    │ Tutor: João     │
│ [Setor ▼]    │                            │ Paciente: Rex   │
│ [Status ▼]   │ ─────────────────────      │ Espécie: Cão    │
│ [Label ▼]    │                            │                 │
│              │ 📥 Tutor: "Oi, gostaria..." │ Tarefas (2)     │
│ ┌──────────┐ │                            │ Notas (1)       │
│ │🟢 João S.│ │ 📤 Atendente: "Claro!..."  │ Alertas (0)     │
│ │Rex - 5min│ │                            │                 │
│ │Recepção  │ │ 📥 Tutor: "É para o Rex"   │ Labels          │
│ └──────────┘ │                            │ [urgente]       │
│              │ ─────────────────────      │ [agendamento]   │
│ ┌──────────┐ │                            │                 │
│ │🔵 Maria  │ │ 💬 [Digite sua mensagem]   │ Transferir      │
│ │Luna - 2h │ │ [📎] [😊] [Enviar]         │ Recepção → ... │
│ │Clínica   │ │                            │                 │
│ └──────────┘ │                            │                 │
└──────────────┴────────────────────────────┴─────────────────┘
```

### 6.3 Kanban View

```
┌──────────────────────────────────────────────────────────────┐
│ 📋 Kanban — Filtros: [Todos Setores ▼] [Labels ▼] [Período ▼]│
├──────────────┬──────────────┬──────────────┬────────────────┤
│ 🟢 NOVO (3)  │ 🔵 ATEND.(5) │ 🟡 PEND.(2)  │ ✅ FINAL.(4)   │
├──────────────┼──────────────┼──────────────┼────────────────┤
│ ┌──────────┐ │ ┌──────────┐ │ ┌──────────┐ │ ┌──────────┐   │
│ │João S.   │ │ │Maria L.  │ │ │Carlos M. │ │ │Ana P.    │   │
│ │Rex 🐕    │ │ │Luna 🐈   │ │ │Thor 🐕   │ │ │Nina 🐕   │   │
│ │🔴Urgente │ │ │Recepção  │ │ │🟡Pendente│ │ │✅ OK     │   │
│ │5min      │ │ │2h        │ │ │1d        │ │ │3h        │   │
│ └──────────┘ │ └──────────┘ │ └──────────┘ │ └──────────┘   │
│ ┌──────────┐ │ ┌──────────┐ │              │ ┌──────────┐   │
│ │Pedro A.  │ │ │Lucia F.  │ │              │ │Bruno T.  │   │
│ │Mimi 🐈   │ │ │Bob 🐕    │ │              │ │Pipoca 🐈 │   │
│ │Agend.    │ │ │Clinica   │ │              │ │✅ OK     │   │
│ │15min     │ │ │45min     │ │              │ │1d        │   │
│ └──────────┘ │ └──────────┘ │              │ └──────────┘   │
└──────────────┴──────────────┴──────────────┴────────────────┘
```

---

## 7. Arquitetura — Fase 9

### 7.1 Novos Módulos

```
modules/
  labels/          — Sistema de labels/tags global
  sectors/         — Setores (evolução de queues)
  contact-groups/  — Grupos de contatos
  transfers/       — Transferência entre setores
  kanban/          — Dashboard Kanban
```

### 7.2 Módulos Modificados

```
modules/
  chat/
    → Adicionar: sector_id, status_v2, label_ids
    → Novos use cases: transferContact, applyLabel, removeLabel
  admin/
    → Adicionar: CRUD de sectors, labels, contact_groups
  dashboard/
    → Adicionar: KPIs do Kanban, métricas por setor
```

### 7.3 Novos Endpoints

#### Labels
```
GET    /labels                    — Listar todas
POST   /labels                    — Criar label
PUT    /labels/:id                — Atualizar
DELETE /labels/:id                — Deletar
POST   /conversations/:id/labels  — Aplicar label em conversa
DELETE /conversations/:id/labels/:labelId — Remover label
POST   /contacts/:id/labels       — Aplicar label em contato
GET    /contacts/:id/labels       — Labels de um contato
```

#### Setores
```
GET    /sectors                   — Listar setores
POST   /sectors                   — Criar setor
PUT    /sectors/:id               — Atualizar
DELETE /sectors/:id               — Deletar
GET    /sectors/:id/conversations — Conversas do setor
GET    /sectors/:id/stats         — Estatísticas do setor
```

#### Grupos de Contatos
```
GET    /contact-groups            — Listar grupos
POST   /contact-groups            — Criar grupo
PUT    /contact-groups/:id        — Atualizar
DELETE /contact-groups/:id        — Deletar
POST   /contact-groups/:id/members — Adicionar contato
DELETE /contact-groups/:id/members/:contactId — Remover contato
GET    /contact-groups/:id/contacts — Contatos do grupo
```

#### Transferências
```
POST   /transfers                 — Criar transferência
GET    /transfers                 — Listar transferências
POST   /transfers/:id/accept      — Aceitar transferência
POST   /transfers/:id/reject      — Rejeitar transferência
GET    /contacts/:id/transfers    — Histórico de transferências
```

#### Kanban
```
GET    /kanban/board              — Dados do board Kanban
GET    /kanban/board/:sectorId    — Board filtrado por setor
PATCH  /kanban/card/:conversationId/move — Mover card (drag & drop)
GET    /kanban/filters            — Filtros disponíveis
```

---

## 8. Frontend — Novas Páginas

### 8.1 Páginas Novas

| Página | Rota | Descrição |
|--------|------|-----------|
| **Kanban** | `/kanban` | Dashboard Kanban com drag & drop |
| **Contatos** | `/contacts` | Lista de contatos com grupos e labels |
| **Grupos** | `/contact-groups` | Gerenciar grupos de contatos |
| **Labels** | `/labels` | Gerenciar labels/tags |
| **Setores** | `/sectors` | Configurar setores |
| **Transferências** | `/transfers` | Histórico de transferências |

### 8.2 Páginas Modificadas

| Página | Mudanças |
|--------|----------|
| **Inbox** | Adicionar filtro por setor, labels no painel lateral, botão transferir |
| **Admin** | Adicionar aba "Setores" e "Labels" |

### 8.3 Componentes Novos

| Componente | Descrição |
|-----------|-----------|
| `KanbanBoard` | Board com colunas e cards arrastáveis |
| `KanbanCard` | Card de conversa no Kanban |
| `KanbanColumn` | Coluna de status no Kanban |
| `LabelBadge` | Badge colorido de label |
| `LabelPicker` | Seletor de labels (multi-select) |
| `SectorBadge` | Badge de setor com ícone |
| `TransferDialog` | Modal de transferência |
| `ContactGroupList` | Lista de grupos de contato |
| `ContactCard` | Card de contato com labels e grupo |

---

## 9. Implementação — Fases da Fase 9

### Sub-fase 9.1 — Labels & Setores (Base)
- Migration de `labels`, `conversation_labels`, `contact_labels`
- Migration de `sectors` (evoluir de `queues`)
- Migration de `contact_sectors`
- Backend: CRUD de labels e sectors
- Frontend: Páginas de Labels e Setores
- Frontend: LabelBadge, LabelPicker, SectorBadge

### Sub-fase 9.2 — Status Granulares & Transferência
- Migration de `conversation_status_v2`
- Migration de `contact_transfers`
- Backend: Novos status de conversa
- Backend: Fluxo de transferência
- Frontend: Botão de transferência na Inbox
- Frontend: Filtros por setor na Inbox

### Sub-fase 9.3 — Grupos de Contatos
- Migration de `contact_groups`, `contact_group_members`
- Backend: CRUD de grupos
- Frontend: Página de Grupos
- Frontend: Filtro por grupo na Inbox e Kanban

### Sub-fase 9.4 — Kanban Dashboard
- Backend: Endpoint de board Kanban
- Backend: Drag & drop (mudança de status)
- Frontend: Página Kanban com drag & drop
- Frontend: Cards dinâmicos com labels e setor
- Frontend: Filtros avançados do Kanban

### Sub-fase 9.5 — Refinamento Premium
- Redesign do layout sidebar com setores dinâmicos
- Badge de contagem por setor na sidebar
- Realtime para atualização de Kanban
- Animações de drag & drop
- Dark mode (opcional)
- Mobile responsive

---

## 10. KPIs do Kanban

| Métrica | Fonte | Descrição |
|---------|-------|-----------|
| Cards por coluna | conversations.status | Contagem por status |
| Tempo médio por status | status_history | Tempo em cada status |
| Conversas por setor | conversations.sector_id | Distribuição por setor |
| Taxa de transferência | contact_transfers | % de conversas transferidas |
| Leads novos (hoje) | conversations + labels | Conversas com label "agendamento"/"duvida" |
| Atendimentos finalizados (hoje) | conversations.status = 'finalizado' | Resolução diária |

---

## 11. Dependências e Riscos

### 11.1 Dependências
- Fase 8 completa (já está)
- Banco PostgreSQL com extensão `uuid-ossp` ou `gen_random_uuid()`
- Realtime conectado ao frontend (já está)

### 11.2 Riscos

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Migração de status quebrar conversas existentes | Alto | Migration com mapeamento automático |
| Performance do Kanban com muitos cards | Médio | Paginação virtual, lazy loading |
| Drag & drop complexo no mobile | Médio | Fallback para menu de ações |
| Labels duplicadas ou inconsistentes | Baixo | Constraint de unicidade |

---

## 12. Referências

- [Chatwoot — Inboxes and Channels](https://github.com/chatwoot/chatwoot)
- [Chatwoot — Labels](https://www.chatwoot.com/features/labels)
- [KanbanWoot — Kanban for Chatwoot](https://github.com/pucabala/kanbanwoot)
- [Chatwoot Developer Docs](https://developers.chatwoot.com)
- [Chatwoot Data Models](https://github.com/chatwoot/chatwoot/wiki/Building-on-Top-of-Chatwoot)

---

**Status:** Plano aprovado para revisão. NÃO implementar até confirmação do Ricardo.
