-- D03 (proposta, NÃO aplicada em produção) — vínculo explícito N:N tutor–paciente.
-- Expand-only e compatível: a coluna legada `patients.tutor_id` permanece até o
-- cutover; o backfill é idempotente e o rollback não toca dados legados.
CREATE TABLE IF NOT EXISTS patient_tutor_links (
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  tutor_id   uuid NOT NULL REFERENCES tutors(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (patient_id, tutor_id)
);

CREATE INDEX IF NOT EXISTS idx_patient_tutor_links_tutor
  ON patient_tutor_links (tutor_id);

-- No máximo um tutor primário por paciente (preserva a leitura 1:N no cutover).
CREATE UNIQUE INDEX IF NOT EXISTS idx_patient_tutor_links_primary
  ON patient_tutor_links (patient_id) WHERE is_primary;

-- Backfill idempotente do legado 1:N para o vínculo explícito.
-- Só promove o tutor legado a PRIMÁRIO quando o paciente ainda não tem um
-- primário: reexecuções após escrita parcial/cutover não violam o índice
-- parcial único nem sobrescrevem uma escolha explícita do operador.
INSERT INTO patient_tutor_links (patient_id, tutor_id, is_primary)
SELECT p.id, p.tutor_id, true
FROM patients p
WHERE p.tutor_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM patient_tutor_links l
    WHERE l.patient_id = p.id AND l.is_primary
  )
ON CONFLICT (patient_id, tutor_id) DO NOTHING;
