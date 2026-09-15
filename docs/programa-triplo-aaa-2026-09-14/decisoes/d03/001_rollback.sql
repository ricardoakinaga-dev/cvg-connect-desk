-- D03 — rollback do expand (não existe DDL em `patients` para desfazer).
-- A coluna legada `patients.tutor_id` permanece intacta; apenas a estrutura
-- nova é removida. Links N:N que só existirem na tabela nova serão perdidos —
-- por isso o rollback só é permitido ANTES do cutover (documentado em D03).
DROP TABLE IF EXISTS patient_tutor_links;
