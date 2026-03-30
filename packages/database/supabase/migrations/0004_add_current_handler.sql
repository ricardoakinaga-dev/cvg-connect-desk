-- Migration: 0004_add_current_handler_to_conversations
-- Description: Adiciona campo current_handler (bot|human) para rastrear responsável atual da conversa

-- 1. Criar ENUM para current_handler se não existir
DO $$ BEGIN
    CREATE TYPE conversation_handler AS ENUM ('bot', 'human');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Adicionar coluna current_handler à tabela conversations
ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS current_handler conversation_handler DEFAULT 'bot' NOT NULL;

-- 3. Criar índice para consultas por current_handler
CREATE INDEX IF NOT EXISTS idx_conversations_current_handler ON conversations(current_handler);

-- 4. Atualizar conversas existentes: se não têm current_handler, setar como 'bot' (já foi feito pelo DEFAULT, mas por segurança)
UPDATE conversations
SET current_handler = 'bot'
WHERE current_handler IS NULL;
