-- Migration 0007: Enterprise Premium — Labels, Sectors, Contact Groups, Transfers
-- Data: 2026-03-30

-- ============================================
-- ENUMS NOVOS
-- ============================================

CREATE TYPE conversation_status_v2 AS ENUM ('novo', 'em_atendimento', 'pendente', 'em_espera', 'finalizado', 'arquivado');
CREATE TYPE contact_group_type AS ENUM ('internal', 'external', 'mixed', 'sector', 'custom');
CREATE TYPE transfer_status AS ENUM ('pending', 'accepted', 'rejected');

-- ============================================
-- LABELS (Tags Globais)
-- ============================================

CREATE TABLE IF NOT EXISTS labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#6b7280',
  description TEXT,
  category TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_labels_name ON labels(name);
CREATE INDEX idx_labels_category ON labels(category);

CREATE TABLE IF NOT EXISTS conversation_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_conv_labels_unique ON conversation_labels(conversation_id, label_id);
CREATE INDEX idx_conv_labels_conversation ON conversation_labels(conversation_id);
CREATE INDEX idx_conv_labels_label ON conversation_labels(label_id);

CREATE TABLE IF NOT EXISTS contact_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_contact_labels_unique ON contact_labels(contact_id, label_id);
CREATE INDEX idx_contact_labels_contact ON contact_labels(contact_id);
CREATE INDEX idx_contact_labels_label ON contact_labels(label_id);

-- ============================================
-- SETORES (Sectors)
-- ============================================

CREATE TABLE IF NOT EXISTS sectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  code VARCHAR(50) NOT NULL,
  description TEXT,
  color VARCHAR(7) NOT NULL DEFAULT '#4361ee',
  icon VARCHAR(10) NOT NULL DEFAULT '📋',
  is_active BOOLEAN NOT NULL DEFAULT true,
  auto_assign BOOLEAN NOT NULL DEFAULT false,
  max_concurrent INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_sectors_code ON sectors(code);

-- Vínculo Contato ↔ Setor
CREATE TABLE IF NOT EXISTS contact_sectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  sector_id UUID NOT NULL REFERENCES sectors(id),
  source_id TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  assigned_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_contact_sectors_unique ON contact_sectors(contact_id, sector_id);
CREATE INDEX idx_contact_sectors_contact ON contact_sectors(contact_id);
CREATE INDEX idx_contact_sectors_sector ON contact_sectors(sector_id);

-- ============================================
-- GRUPOS DE CONTATOS
-- ============================================

CREATE TABLE IF NOT EXISTS contact_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(150) NOT NULL,
  description TEXT,
  group_type contact_group_type NOT NULL DEFAULT 'custom',
  sector_id UUID REFERENCES sectors(id),
  color VARCHAR(7) DEFAULT '#6b7280',
  icon VARCHAR(10) DEFAULT '👥',
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_contact_groups_type ON contact_groups(group_type);
CREATE INDEX idx_contact_groups_sector ON contact_groups(sector_id);

CREATE TABLE IF NOT EXISTS contact_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES contact_groups(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  added_by UUID REFERENCES users(id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_group_members_unique ON contact_group_members(group_id, contact_id);
CREATE INDEX idx_group_members_group ON contact_group_members(group_id);
CREATE INDEX idx_group_members_contact ON contact_group_members(contact_id);

-- ============================================
-- TRANSFERÊNCIAS ENTRE SETORES
-- ============================================

CREATE TABLE IF NOT EXISTS contact_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  conversation_id UUID REFERENCES conversations(id),
  from_sector_id UUID REFERENCES sectors(id),
  to_sector_id UUID NOT NULL REFERENCES sectors(id),
  from_user_id UUID REFERENCES users(id),
  to_user_id UUID REFERENCES users(id),
  reason TEXT,
  status transfer_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_transfers_contact ON contact_transfers(contact_id);
CREATE INDEX idx_transfers_conversation ON contact_transfers(conversation_id);
CREATE INDEX idx_transfers_from_sector ON contact_transfers(from_sector_id);
CREATE INDEX idx_transfers_to_sector ON contact_transfers(to_sector_id);
CREATE INDEX idx_transfers_status ON contact_transfers(status);

-- ============================================
-- CONVERSATIONS — Novas colunas
-- ============================================

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS status_v2 conversation_status_v2 NOT NULL DEFAULT 'novo';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS sector_id UUID REFERENCES sectors(id);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS assigned_user_id UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_conversations_status_v2 ON conversations(status_v2);
CREATE INDEX IF NOT EXISTS idx_conversations_sector ON conversations(sector_id);
CREATE INDEX IF NOT EXISTS idx_conversations_assigned ON conversations(assigned_user_id);

-- ============================================
-- SEED: Labels padrão
-- ============================================

INSERT INTO labels (name, color, description, category, is_system) VALUES
  ('urgente', '#ef4444', 'Conversa urgente', 'prioridade', true),
  ('agendamento', '#3b82f6', 'Solicitação de agendamento', 'tipo', true),
  ('duvida', '#eab308', 'Dúvida geral', 'tipo', true),
  ('orcamento', '#22c55e', 'Solicitação de orçamento', 'tipo', true),
  ('retorno', '#a855f7', 'Retorno de atendimento', 'tipo', true),
  ('vacinacao', '#f97316', 'Serviço de vacinação', 'serviço', true),
  ('exame', '#06b6d4', 'Solicitação de exame', 'serviço', true),
  ('internacao', '#dc2626', 'Paciente internado', 'serviço', true),
  ('cirurgia', '#b91c1c', 'Agendamento de cirurgia', 'serviço', true),
  ('vip', '#fbbf24', 'Cliente VIP', 'status', true),
  ('inadimplente', '#991b1b', 'Cliente inadimplente', 'financeiro', true),
  ('primeira-vez', '#16a34a', 'Primeira consulta', 'tipo', true)
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- SEED: Setores padrão
-- ============================================

INSERT INTO sectors (name, code, description, color, icon) VALUES
  ('Recepção', 'recepcao', 'Primeiro atendimento, agendamentos, dúvidas', '#3b82f6', '🏥'),
  ('Clínica Médica', 'clinica', 'Consultas, exames, resultados', '#22c55e', '🩺'),
  ('Internação', 'internacao', 'Pacientes internados', '#f97316', '🏨'),
  ('Cirurgia', 'cirurgia', 'Agendamento e acompanhamento cirúrgico', '#ef4444', '⚕️'),
  ('Comercial', 'comercial', 'Orçamentos, pacotes, vacinas', '#a855f7', '💼'),
  ('Farmácia', 'farmacia', 'Medicamentos, dispensação', '#06b6d4', '💊'),
  ('Administrativo', 'admin', 'Cobrança, documentos, reclamações', '#6b7280', '📋')
ON CONFLICT (code) DO NOTHING;
