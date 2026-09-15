# SA-015 — Relatório de implementação (Builder A)

**Status: REWORK** — AC2 provado; AC3 provado (com 1 desvio de mapeamento de entrada); AC1
parcialmente provado e com **3 defeitos de produto abertos** (patch mínimo proposto abaixo,
para aplicação pelo lead — nenhum arquivo de produto foi alterado por este builder).

- Candidato: `754f9bad+worktree#fe8280bef538251e`
- Arquivo novo: `apps/desk-api/src/__tests__/sa-015-tasks-hardening.integration.test.ts`
  sha256 `b5fe2459842e916b721dfe29e2f637f73268117c3dc0a4d47d3bfe08f06c8d1c`
- Evidência: `evidencias/SA-015/evidence.jsonl` (+ runner summaries/logs, `probe-observations.json`)
- Nenhuma alteração em código de produto, fixtures, schema/migrações, lockfile ou `BACKLOG.json`.

## Comandos e resultados

| Execução | Worker | Ambiente | Comando | Resultado |
|---|---|---|---|---|
| r1 | 44 | pg 60832 / redis 57120 | runner + vitest (abaixo) | PASS 11/11, exit 0 |
| r2 (principal) | 45 | pg 60932 / redis 57140 | `node scripts/production/run-integration-isolated.mjs --run-id sa015-b1-20260915-r2 --worker 45 --skip-seed -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/sa-015-tasks-hardening.integration.test.ts` | PASS 11/11, exit 0 |
| r3 (CI-shaped) | 46 | pg 61032 / redis 57140 | idem com `-- bash -lc "env -u AAA_RUN_ID pnpm ..."` | PASS 11/11, exit 0 |

`11 testes = 7 asserções + 4 it.fails` (it.fails documentam os defeitos e viram XPASS quando
corrigidos). Typecheck (`pnpm --filter @cvg/desk-api typecheck`) e eslint do arquivo: limpos.
Nenhuma porta do host (5432/6379) foi usada.

## Mapa AC → prova

### SA-015-AC1 — vínculo validado e criação atômica (PARCIAL)

| Cenário | Prova | Novo ou citado |
|---|---|---|
| POST /tasks com `conversationId` inexistente/cross-setor → 404 idêntico | NOVO (contexto) + citado **sa-013 caso 6** | novo: **zero órfãos** (tasks/history/audit/outbox) |
| Criação autorizada: task + histórico(pending) + audit `task.created` + outbox `task.created` no mesmo commit | NOVO (contagens por correlação + linha de histórico) | citado **prod-18 AC1** (rollback por trigger) |
| Leitura cross-ator 404; tarefa sem conversa só criador/assignee | NOVO (parcial) | citado **prod-04 AC2.5**, **aaa-04**, **sa-013 caso 7** |
| `dueAt` ISO e `priority` persistidos/consultados (round-trip + filtro) | NOVO | — |
| Tutor/paciente válidos persistem; inexistentes não são aceitos e não deixam órfãos | NOVO | — |
| Responsável "só entre permitidos" | **DEFEITO D3** (fora do setor é aceito) | — |

### SA-015-AC2 — CAS, 409 e idempotência (PROVADO)

| Cenário | Prova | Novo ou citado |
|---|---|---|
| Corrida com o MESMO `expectedStatus` → exatamente um efeito, 200/409 | NOVO (variante mesmo-alvo) | citado **prod-18 AC4** (200+409) |
| CAS determinístico: transação segura o lock, PATCH que leu estado antigo → 409 `TASK_STATUS_CONFLICT` sem efeito parcial | NOVO | — |
| Recuperação pós-409 relendo o estado; repetição idempotente sem duplicar histórico/audit/outbox | NOVO | citado **prod-18 AC3** (dedup 1/1/1) |
| Falha no último efeito reverte todos | — | citado **prod-18 AC1** (trigger no outbox) |

### SA-015-AC3 — paginação/filtros canônicos (PROVADO; D4 é desvio de entrada)

| Cenário | Prova | Novo ou citado |
|---|---|---|
| `conversationId` devolve só a conversa pedida; 404 inacessível; UUID inválido 400 | NOVO (mesmo setor + sem vínculo) | citado **sa-008**, **sa-013** |
| Paginação: default 100, teto 200, piso 1, offset ≥ 0; HTTP 400 fora da faixa; páginas sem sobreposição | NOVO | citado **sa-008** (limit=1 aplica) |
| `dueAt`/`priority` consistentes | NOVO | — |
| `dueAt` inválido → 500 | **DEFEITO D4** | — |

## Defeitos (reprodução + patch mínimo proposto)

Reprodução executável: `it.fails` no arquivo novo; observações em `probe-observations.json`
(status HTTP real de cada probe).

- **D1/D2 — `tutorId`/`patientId` inexistente ⇒ HTTP 500** (AC1/C01 pedem 4xx).
  `create-task.use-case.ts` insere direto e o erro de FK (23503) vira `INTERNAL_ERROR`.
- **D3 — `assignedTo` fora do setor da conversa ⇒ 201 ACEITO** (viola AC1 "responsável só
  entre permitidos"); `assignedTo` inexistente também ⇒ 500.
- **D4 — `dueAt` inválido (`'nao-e-data'`) ⇒ HTTP 500** (C01 pede 4xx).

Patch mínimo proposto (nenhum aplicado):

1. `modules/tasks/src/presentation/http/task.controller.ts` — no schema do body, adicionar
   `format: 'uuid'` a `tutorId`/`patientId`/`assignedTo` e `format: 'date-time'` a `dueAt`
   (400 para malformado).
2. No handler `POST /tasks`, pré-checar existência:
   `db.select({id: schema.tutors.id}).from(schema.tutors).where(eq(schema.tutors.id, id))`
   (idem `schema.patients`) ⇒ 404 `NOT_FOUND` quando ausente; se ambos vierem, exigir
   `patient.tutorId === tutorId`.
3. Validar `assignedTo` com o padrão canônico de `assignConversation`
   (`modules/chat/.../conversation-operations.use-case.ts:250-296`): usuário ativo e, quando a
   conversa tem setor, membership em `user_sectors` ou papel `Admin`; senão
   `400 INVALID_ASSIGNEE`. O usuário da conversa já é carregado para a autorização de vínculo —
   reutilizar o `sectorId` retornado.
4. Após o patch, remover os marcadores `.fails` dos 4 testes de defeito e reexecutar o runner.

## Limitações

- Suítes citadas foram inspecionadas (asserções lidas), não reexecutadas nesta rodada; a
  regressão integrada é responsabilidade do gate do candidato.
- Não existem `apps/desk-api/src/__tests__/tasks-*.test.ts` no candidato; a cobertura de tasks
  está em `sa-008`, `sa-011`, `sa-013`, `aaa-04`, `production/prod-04`, `production/prod-18`,
  `modules/tasks/src/__tests__/*` e `e2e/smoke/create-task.test.ts` (web).
- `tutors`/`patients` não têm setor no schema: o aceite "escopo" só pode ser exigido como
  existência (+ coerência paciente↔tutor); não há modelo de autorização de tutor/paciente.
- O r3 simula CI-shaped (`env -u AAA_RUN_ID`) no banco isolado; não substitui o `pnpm test:ci`
  macro do gate.
- Revisão sem autoria (reviewer) pendente.
