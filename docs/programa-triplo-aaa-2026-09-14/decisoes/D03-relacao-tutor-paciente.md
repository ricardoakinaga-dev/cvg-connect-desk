# D03 — Relação tutor–paciente (N:N): inventário, proposta e ensaio

**Estado da decisão:** `OPEN` — este documento **não** aprova a mudança de cardinalidade; ele a torna revisável e executável.
**Tarefa:** SA-020 (AC1/AC2/AC3). **Autoridade:** Produto + Responsável pelos dados (nomes a registrar em D01–D06).
**Data:** 14/09/2026 · **Candidato:** `754f9bad+worktree#c850555d…` (ver `evidencias/SA-001/candidate-manifest.json`).

## 1. Cardinalidade hoje (AC1)

`patients.tutor_id uuid REFERENCES tutors(id)` — **1 tutor por paciente (N:1)**, anulável (`packages/database/src/schema.ts`). Não existe tabela de vínculo; o "tutor principal" é implícito.

Casos de múltiplos tutores existem no domínio (ex.: casal/tutores compartilhados, responsável financeiro distinto do responsável clínico) e hoje **não têm representação**: o cadastro perde o segundo vínculo ou duplica o paciente.

### Consumidores inventariados de `tutorId`/`tutor_id`

**Contagem reproduzível:** `113` linhas em arquivos `.ts/.tsx/.sql` (exclui `node_modules`, `dist` e `.d.ts` gerados) pelo comando registrado em `decisoes/d03/inventory-tutor-id.txt` (mesmo arquivo com todas as linhas). Contagens por arquivo abaixo; a tabela não substitui o inventário bruto, que é a evidência.

| Área | Arquivo | Ocorrências | Papel do campo |
|---|---|---:|---|
| Schema | `packages/database/src/schema.ts` | 4 | coluna + FK + índices |
| Pacientes (domínio) | `modules/patients/src/infrastructure/repositories/patient.repository.ts` | 9 | CRUD/filtro/validação |
| Pacientes (casos de uso) | `modules/patients/src/application/use-cases/index.ts` | 6 | valida tutor, cria/atualiza, lista por tutor |
| Pacientes (HTTP) | `modules/patients/src/presentation/http/patient.controller.ts` | 4 | querystring/body `tutorId` |
| Pacientes (tipos) | `modules/patients/src/types/index.ts` | 3 | DTO `tutorId` |
| Tutores | `modules/tutors/src/infrastructure/repositories/tutor.repository.ts` | 6 | agrega pacientes do tutor |
| Tarefas | `modules/tasks/src/application/use-cases/create-task.use-case.ts`, `.../task.controller.ts` | 4 | vínculo opcional da tarefa ao tutor |
| Privacidade | `modules/privacy/src/application/contact-graph.ts`, `.../scoped-export.ts` | 4 | grafo do titular (contato→tutor→pacientes) |
| Secretary/IA | `modules/secretary-adapter/src/infrastructure/request-builder.ts`, `.../invoke-secretary.use-case.ts`, `types.ts` | 5 | contexto do tutor na invocação |
| Contatos | `modules/contacts/src/types/index.ts` | 1 | referência de vínculo |
| Web | `apps/desk-web/src/pages/Patients.tsx` (9), `Tasks.tsx` (9), `Inbox.tsx` (5), `lib/api.ts` (5) | 28 | seleção/listagem/vínculo em UI |
| Testes | `modules/patients/src/__tests__/use-cases.test.ts`, `modules/secretary-adapter/src/__tests__/invoke-secretary.integration.test.ts`, `apps/desk-api/src/__tests__/aaa-17.integration.test.ts`, `production/prod-04.test.ts`, `production/prod-06.test.ts`, `apps/desk-web/src/__tests__/entities.test.tsx`, `modules/tutors/src/__tests__/repository-structure.test.ts` | — | contratos atuais 1:N |
| Migrações (DDL) | `packages/database/supabase/migrations/0013_security_correctness.sql`, `0001_chat_core.sql`, `0006_tasks_tutor_patient.sql` | — | criação/índices da coluna legada |

**Consequência:** qualquer mudança precisa cobrir os quatro consumidores de leitura sensíveis (privacidade/DSAR, Secretary, tarefas e UI) e o filtro `patients?tutorId=`.

## 2. Proposta N:N (AC2)

**Modelo:** vínculo explícito com primário opcional.

```sql
CREATE TABLE patient_tutor_links (
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  tutor_id   uuid NOT NULL REFERENCES tutors(id)   ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (patient_id, tutor_id)
);
CREATE INDEX idx_patient_tutor_links_tutor ON patient_tutor_links (tutor_id);
CREATE UNIQUE INDEX idx_patient_tutor_links_primary
  ON patient_tutor_links (patient_id) WHERE is_primary;
```

- **Uniqueness/FK:** PK composta impede vínculo duplicado; `ON DELETE CASCADE` nos dois lados; índice parcial garante **no máximo um primário** por paciente (preserva leitura 1:N no cutover).
- **Backfill idempotente e seguro a divergência:** `INSERT ... SELECT ... WHERE p.tutor_id IS NOT NULL AND NOT EXISTS (primário do paciente) ON CONFLICT DO NOTHING` — uma reexecução após escrita parcial/cutover (paciente que já tem outro primário) **não viola** o índice parcial único nem sobrescreve a escolha explícita do operador. Caso coberto pelo ensaio (`backfill_respeita_primario_divergente`, `backfill_nao_promove_vinculo_nao_primario`).
- **Compatibilidade de leitura (fase expand):** `patients.tutor_id` permanece como fonte primária; API/UI continuam funcionando sem alteração; `GET /patients?tutorId=` passa a considerar, no cutover, links + legado.
- **Contrato da API (cutover, a decidir):** `GET /patients` retorna `tutorIds: string[]` **aditivo** e mantém `tutorId` (primário) para consumidores antigos; `POST/PUT /patients` aceita `tutorIds` (valida existência de cada tutor) e deriva `tutorId` do primário (ou do primeiro).
- **Privacidade:** o grafo do titular (`contact-graph`) passa a unir pacientes por `patient_tutor_links` **e** pelo legado durante a transição; exportação por escopo não muda de forma.
- **Rollback/rollforward:** `d03/001_rollback.sql` remove apenas a estrutura nova. **Antes do cutover** é seguro (nenhum dado só existe nela). **Depois do cutover**, links N:N sem representação no legado seriam perdidos — por isso o rollback pós-cutover exige decisão explícita e um dump da tabela nova.
- **Ensaio executado (isolado, sem dados reais):** **12/12** checagens em `evidencias/SA-020/rehearsal.json` — backfill do legado, primário, idempotência, PK composta, um primário por paciente, N:N real (dois tutores), **divergência de primário**, **não promoção de vínculo não-primário**, **perda explícita do vínculo N:N no rollback**, rollback preservando `patients.tutor_id`, remoção da tabela nova e rollforward reconstruindo o legado sem perda.

## 3. Alternativas e impacto (AC3)

| Opção | Mudança | Impacto | Risco |
|---|---|---|---|
| **A. Manter 1:N (atual)** | Nenhuma | Requisito B13/UI09–UI10 permanece não atendido; segundo tutor continua sem representação | Nenhum técnico; produto não fecha o alvo documentado |
| **B. N:N com primário (proposta)** | Migração expand-only + backfill + contrato aditivo + UI de múltiplos vínculos | Schema, API, UI de pacientes, privacidade, Secretary e tarefas; ensaio e plano de cutover | Migração em tabela quente; exige janela e dry-run; rollback pós-cutover precisa de dump |
| **C. 1:N + campos extras (contato secundário textual)** | Sem tabela nova | Atende parcialmente a UI, mas quebra consultas por tutor e privacidade (dados não relacionais) | Dívida de dados; não é o alvo |

**Recomendação técnica:** **B**, com cutover em duas fases (expand agora; troca da fonte de leitura após UI/API atualizadas), mantendo `patients.tutor_id` até a fase 2.

## 4. Subações dependentes e autoridade

- Bloqueadas até a decisão: `SA-021` (implementação da relação e cadastros robustos) e a parte N:N de `SA-042` (fichas de pacientes).
- **Não** bloqueadas: este inventário, o ensaio, o contrato aditivo e qualquer correção independente.
- Autoridade: Produto + Responsável pelos dados; registro de fechamento em `DECISOES.md` (D03 continua `OPEN`, com este pacote anexado como proposta revisável).

## 5. Registro de fechamento (vazio até decisão)

| Campo | Valor |
|---|---|
| Status | OPEN |
| Autoridade nominal | **a registrar** — aceito explicitamente nesta proposta: o inventário/ensaio **não** substitui a decisão de Produto + Responsável pelos dados, que deve registrar nome e data em `DECISOES.md` |
| Data | — |
| Escopo aprovado | — |
| Versão de contrato | D-1 (proposta; contrato C07) |
| Evidência da instrução | — |
| Restrições | rollback só antes do cutover sem dump |
