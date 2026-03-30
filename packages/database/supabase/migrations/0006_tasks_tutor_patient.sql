-- Migration: 0006_tasks_tutor_patient
-- Description: Adiciona tutorId e patientId na tabela tasks

-- Adicionar colunas tutorId e patientId
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS tutor_id uuid REFERENCES tutors(id),
ADD COLUMN IF NOT EXISTS patient_id uuid REFERENCES patients(id);

-- Criar índices
CREATE INDEX IF NOT EXISTS idx_tasks_tutor ON tasks(tutor_id);
CREATE INDEX IF NOT EXISTS idx_tasks_patient ON tasks(patient_id);
