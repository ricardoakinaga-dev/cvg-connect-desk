# D03 - Proposta: tutor-paciente N:N documentado x 1:N implementado

**Estado da decisão: OPEN (não ratificada).** Este documento é inventário e proposta
técnica do PROD-06 (AC3). Nada de N:N foi implementado; a migração relacional e o
contrato definitivo pertencem a **PROD-25** e dependem da ratificação de D03 por
Produto + Dados (`DECISOES.md`).

## Inventário (real x documentado)

| Fonte | Modelo declarado | Evidencia |
|---|---|---|
| `docs/09-data-model.md` SS6.4 e SS14.2 | Tabela `tutor_patients` N:N com FK para tutor e paciente e unicidade em `(tutor_id, patient_id)` | data model |
| `packages/database/src/schema.ts` | `patients.tutorId` (1:N, FK `patients_tutor_id_fkey`) | schema Drizzle + DDL real |
| Migrations 0001/0006 | `patients.tutor_id`; nenhuma migration cria `tutor_patients` | migrations 0000..0023 |
| Repositorios de pacientes e tutores | CRUD, filtro e contagem por `schema.patients.tutorId` | codigo real |

Conclusão do inventário: a documentação descreve um agregado tutor-paciente N:N,
enquanto o produto implementa 1:N (`patients.tutor_id`). Não existe tabela,
índice, FK ou código de `tutor_patients`.

## Impacto

- **Dados:** pacientes com mais de um tutor nao sao representaveis sem duplicar o
  paciente ou perder integridade do segundo vinculo.
- **Contratos:** inbox, tarefas, notas, IA e privacidade assumem hoje um tutor
  singular; a mudanca exige revisar C07/C08.
- **Privacidade/LGPD:** N:N exige percorrer a tabela de vinculos e definir o
  comportamento de exclusao ou pseudonimizacao de cada tutor.
- **Interface:** `apps/desk-web` exibe um unico tutor por paciente; N:N muda
  formulario e listagem.
- **Compatibilidade:** `patient.tutorId` deve permanecer como projecao do tutor
  principal durante o rollout.

## Migração

Esta proposta é para PROD-25 e **não deve ser executada no PROD-06**.

1. **Expand:** criar `tutor_patients` com `id`, FKs, `relationship_type`,
   `created_at` e unicidade `(tutor_id, patient_id)`; fazer backfill idempotente
   a partir de `patients.tutor_id` e manter a coluna antiga.
2. **Dual-write/leitura:** gravar o vínculo N:N e manter `patients.tutor_id`
   sincronizado ao tutor principal para leitores antigos.
3. **Contract:** somente depois de D03 ratificada e de um deploy sem leitores do
   campo, avaliar tornar `patients.tutor_id` derivado ou removível.
4. **Índices:** cobrir consultas por `patient_id` e `tutor_id`, incluindo a
   unicidade composta.

## Compatibilidade

- Enquanto D03 estiver OPEN, nada muda em `patient.tutorId`; nenhum contrato atual
  quebra.
- A tabela N:N futura é aditiva; rollback consiste em parar a escrita nova e
  preservar os dados para reprocessamento.
- Consumidores que precisarem de todos os tutores usarão `tutor_patients`; os que
  precisarem do principal usarão a projeção. C08 deve ser revisado antes.

## Decisão

- Estado: **OPEN** em D03 (`DECISOES.md`), com Produto + Dados como responsáveis
  funcionais; PROD-25 permanece bloqueado para a migração.
- Recomendação: implementar N:N compatível, aditivo, com projeção do tutor
  principal, sujeita a ratificação.
- O que PROD-06 entrega: inventário, proposta e confirmação de que nenhuma tabela
  `tutor_patients` foi criada.
- **N:N não implementado por decisão D03 OPEN.**
