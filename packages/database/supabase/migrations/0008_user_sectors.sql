-- Migration 0008: Permissões por Setor (User Sectors)
-- Data: 2026-03-30

-- ============================================
-- Vínculo Usuário ↔ Setor (permissão de acesso)
-- ============================================

CREATE TABLE IF NOT EXISTS user_sectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sector_id UUID NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
  access_level VARCHAR(20) NOT NULL DEFAULT 'read',  -- 'read', 'write', 'admin'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_user_sectors_unique ON user_sectors(user_id, sector_id);
CREATE INDEX idx_user_sectors_user ON user_sectors(user_id);
CREATE INDEX idx_user_sectors_sector ON user_sectors(sector_id);

-- ============================================
-- SEED: Admin tem acesso a todos os setores
-- ============================================

INSERT INTO user_sectors (user_id, sector_id, access_level)
SELECT 
  u.id,
  s.id,
  'admin'
FROM users u
CROSS JOIN sectors s
WHERE u.email = 'admin@cvg.com'
ON CONFLICT (user_id, sector_id) DO NOTHING;
