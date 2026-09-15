# D03 — Proposta: tutor–paciente N:N documentado × 1:N implementado

**Estado da decisão: OPEN (não ratificada).** Este documento é inventário e proposta
técnica do PROD-06 (AC3). Nada de N:N foi implementado; a migração relacional e o
contrato definitivo pertencem a **PROD-25** e dependem da ratificação de D03 por
Produto + Dados (`docs/producao-2026-09-13/DECISOES.md`).

## Inventário (real × documentado)

| Fonte | Modelo declarado | Evidência |
|---|---|---|
| `docs/09-data-model.md` §6.4 (linhas 296–307) | Tabela `tutor_patients` N:N (`id`, `tutor_id` FK, `patient_id` FK, `relationship_type`, `created_at`; único em `(tutor_id, patient_id)`) | texto do data model |
| `docs/09-data-model.md` §14.2 (linha 650) | Unicidade crítica em `(tutor_id, patient_id)` em `tutor_patients` | texto do data model |
| `docs/09-data-model.md` §6.2 | `tutors.contact_id` FK → `contacts.id` | texto do data model |
| `docs/09-data-model.md` §6.3 | `patients` **sem** `tutor_id` | texto do data model |
| `packages/database/src/schema.ts:46` | `patients.tutorId` (1:N, FK `patients_tutor_id_fkey`) | schema drizzle + DDL real |
| `packages/database/src/schema.ts:19-20,138-139` | `contacts.tutor_id/patient_id` e `tasks.tutor_id/patient_id` (1:N) | schema drizzle + DDL real |
| Migrations 0001/0006 | `patients.tutor_id` e FKs; **nenhuma** migration cria `tutor_patients` | `packages/database/supabase/migrations/0000..0023` |
| `modules/patients/src/infrastructure/repositories/patient.repository.ts:6,18,34,72,83` | CRUD e filtro por `tutorId` único; join `patients.tutor_id = tutors.id` | código real |
| `modules/tutors/src/infrastructure/repositories/tutor.repository.ts:78,99` | contagem/listagem de pacientes por `schema.patients.tutorId` | código real |
| `modules/patients/src/application/use-cases/index.ts:23-30,43-50,65` | valida existência do tutor único antes de create/update | código real |
| `docs/09-data-model.md` §7.1 | `conversations.tutor_id/patient_id` documentados | **ausentes** no schema/DDL real (só `contact_id`; contato carrega tutor/paciente) |

Conclusão do inventário: a documentação descreve um agregado tutor↔paciente N:N
(com `tutors.contact_id` e `patients` sem tutor), enquanto o produto implementa
1:N (`patients.tutor_id` NOT NULL? — coluna nullable, mas um único tutor por
paciente) e deriva o vínculo da conversa via `contacts.tutor_id/patient_id`.
Não existe tabela, índice, FK ou código de `tutor_patients`.

## Impacto

- **Dados:** pacientes com mais de um tutor não são representáveis; um tutor
  adicional exige duplicar o paciente (perde identidade clínica) ou registrar o
  segundo tutor por texto livre, sem integridade/consulta.
- **Contratos (C07/C08):** consumidores (inbox, tarefas, notas, IA, privacidade)
  hoje assumem `patient.tutorId` singular; `modules/privacy` percorre o grafo
  contato→tutor/paciente (`modules/privacy/src/application/contact-graph.ts`).
- **Privacidade/LGPD:** eliminação/pseudonimização de um tutor precisa alcançar
  todos os pacientes vinculados; 1:N facilita, N:N exige varredura pela tabela de
  vínculo (ou dois FKs), com risco de sobra de vínculo órfão se não houver
  `ON DELETE CASCADE`.
- **Interface:** `apps/desk-web` exibe um único tutor por paciente
  (`pages/Patients.tsx`); N:N muda formulário e listagem.
- **Compatibilidade de leitura:** `patient.tutorId` deve permanecer como projeção
  do “tutor principal” durante o rollout.

## Migração proposta (para PROD-25 — não executar aqui)

Expand/contract, sem DROP destrutivo precoce:

1. **Expand (0024+):** criar `tutor_patients (id uuid pk, tutor_id uuid not null
   references tutors(id), patient_id uuid not null references patients(id),
   relationship_type text, created_at timestamptz not null default now(),
   unique (tutor_id, patient_id))`; backfill
   `INSERT INTO tutor_patients (tutor_id, patient_id) SELECT tutor_id, id FROM patients WHERE tutor_id IS NOT NULL`
   (idempotente via `ON CONFLICT DO NOTHING`). Manter `patients.tutor_id` intacto.
2. **Dual-write/leitura:** writers passam a gravar o vínculo N:N e a manter
   `patients.tutor_id` sincronizado ao “principal” (menor `created_at` ou marcador
   explícito) para leitores antigos. Nenhum leitor é obrigado a migrar no mesmo deploy.
3. **Contract (depois de PROD-25 ratificar e após um deploy sem leitores do campo):**
   opcionalmente tornar `patients.tutor_id` derivado/removível; só então avaliar
   `DROP COLUMN` (nunca nesta tarefa).
4. **Índices:** único `(tutor_id, patient_id)`; índices de consulta por
   `patient_id` e por `tutor_id` (o único cobre o prefixo por tutor); índices
   parciais para “principal” se o marcador for adotado.

## Compatibilidade

- Correção independente (sem N:N): nada muda em `patient.tutorId`; nenhum
  contrato atual quebra. Esta é a única ação autorizada pelo estado OPEN.
- Durante a migração futura: `patients.tutor_id` continua sendo o campo de
  leitura/escrita; a tabela N:N é aditiva; rollback = parar de escrever na tabela
  nova e mantê-la (perda zero).
- Após contract: consumidores que precisem de “todos os tutores” usam
  `tutor_patients`; quem precisa do principal usa a projeção. É necessário revisar
  C08 (contrato Dados/IA) antes de tocar qualquer consumidor.

## Decisão

- Estado: **OPEN** em `docs/producao-2026-09-13/DECISOES.md` D03
  (Produto + Dados; bloqueia PROD-25).
- Proposta padrão registrada no plano: **implementar N:N compatível** (aditivo,
  com projeção do tutor principal) — sujeita a ratificação; este PROD-06 **não**
  escolhe nem implementa.
- O que PROD-06 entrega: este inventário, a proposta acima e a confirmação de que
  nenhuma tabela `tutor_patients` foi criada (ver teste `prod-06.test.ts` AC3.1).
- **N:N não implementado por decisão D03 OPEN.**
