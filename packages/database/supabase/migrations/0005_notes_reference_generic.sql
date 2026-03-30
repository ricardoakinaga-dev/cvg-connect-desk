-- Migration: 0005_notes_reference_generic
-- Description: Adiciona suporte a referências genéricas em internal_notes (conversation, task, tutor, patient)

-- 1. Criar ENUM para note_reference_type se não existir
DO $$ BEGIN
    CREATE TYPE note_reference_type AS ENUM ('conversation', 'task', 'tutor', 'patient');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Adicionar colunas reference_type e reference_id
ALTER TABLE internal_notes
ADD COLUMN IF NOT EXISTS reference_type note_reference_type,
ADD COLUMN IF NOT EXISTS reference_id uuid;

-- 3. Criar índice composto para consultas por referência
CREATE INDEX IF NOT EXISTS idx_notes_reference ON internal_notes(reference_type, reference_id);

-- 4. Migrar dados existentes: conversation_id -> reference_type='conversation', reference_id=conversation_id
UPDATE internal_notes
SET reference_type = 'conversation', reference_id = conversation_id
WHERE conversation_id IS NOT NULL AND reference_type IS NULL;

-- 5. Migrar dados existentes: task_id -> reference_type='task', reference_id=task_id
UPDATE internal_notes
SET reference_type = 'task', reference_id = task_id
WHERE task_id IS NOT NULL AND reference_type IS NULL;

-- 6. Remover NOT NULL de conversationId (tornar nullable)
-- Primeiro, verificar se a coluna existe e tem constraint
DO $$ 
DECLARE 
    col_exists boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='internal_notes' AND column_name='conversation_id' AND is_nullable='NO'
    ) INTO col_exists;
    
    IF col_exists THEN
        ALTER TABLE internal_notes ALTER COLUMN conversation_id DROP NOT NULL;
    END IF;
END $$;

-- 7. (Opcional) No futuro, remover taskId se desejado. Por enquanto manter para compatibilidade.
