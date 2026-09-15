# SA-019 — Defeitos reproduzidos (candidato `754f9bad+worktree#fe8280bef538251e`)

**Estado: REWORK.** O teste `apps/desk-api/src/__tests__/sa-019-memberships.integration.test.ts`
foi implementado e executado no runner isolado (SA-003): **11 passed | 11 failed (22)**.
Nenhum arquivo de produto foi alterado (somente o teste novo e esta evidência). Os patches
abaixo são propostas mínimas para o lead aplicar; depois de aplicados, o mesmo teste deve
ficar verde sem enfraquecer nenhuma asserção.

Comando (reprodução exata):

```
node scripts/production/run-integration-isolated.mjs \
  --run-id sa019-memberships-754f9bad --worker 44 --skip-seed -- \
  pnpm --filter @cvg/desk-api exec vitest run \
  src/__tests__/sa-019-memberships.integration.test.ts
```

Run: `evidencias/integration-runs/sa019-memberships-754f9bad/` (exit 1; db
`cvg_aaa_sa019_memberships_754f9bad_w44` em 127.0.0.1:60832; `sourceRevision`
`754f9badac46278e77d21de91c58eedb15e80581`; marcador conferido).

---

## D1 — Anexar/mover duplicata devolve 500 (repetição NÃO idempotente)

**Repro (três rotas, mesmo padrão):**

- `POST /conversations/:id/labels {labelId}` duas vezes → 2º `500 {"error":"INTERNAL_ERROR"}`.
- `POST /contacts/:id/labels {labelId}` duas vezes → 2º `500`.
- `POST /contact-groups/:id/members {contactId}` duas vezes → 2º `500`.
- Em concorrência (`Promise.all`, duas requisições simultâneas) uma vira 500.

**Causa:** inserts sem tratamento de conflito contra os índices únicos
`idx_conv_labels_unique` (`packages/database/src/schema.ts:353`),
`idx_contact_labels_unique` (`:365`) e `idx_group_members_unique` (`:428`):

- `modules/labels/src/infrastructure/repositories/label.repository.ts:55` (`addConversationLabel`) e `:80` (`addContactLabel`);
- `modules/contact-groups/src/infrastructure/repositories/contact-group.repository.ts:59` (`addMember`).

**Impacto:** AC1/SA-019 ("repetição idempotente") e AC2 ("duplicatas idempotentes",
"associação concorrente não duplica"); retry de cliente vira erro interno e o erro
Postgres ainda é mascarado como `INTERNAL_ERROR`.

**Patch mínimo proposto (não aplicado):**

```ts
// label.repository.ts — addConversationLabel e addContactLabel
await db.insert(conversationLabels).values({ ... }).onConflictDoNothing();
// idem contactLabels
```

```ts
// contact-group.repository.ts — addMember
await db.insert(contactGroupMembers).values({ ... }).onConflictDoNothing();
```

---

## D2 — Contato inexistente em `POST /contacts/:id/labels` → 500 (FK), não 404

**Repro:** `POST /contacts/<uuid-inexistente>/labels {labelId: <label real>}` →
`500 {"error":"INTERNAL_ERROR"}` (violação de FK `contact_labels.contact_id → contacts.id`).

**Causa:** o handler (`modules/labels/src/presentation/http/label.controller.ts:230`)
não verifica existência antes de `authorizeContactResource`; sem vínculos,
`authorizeContactResource` libera por política de diretório
(`packages/auth/src/resource-authz.ts:212-214`) e o insert estoura a FK.

**Impacto:** AC2 ("sem aceitar vínculo a contato inacessível/inexistente") e contrato C02
(404 com corpo idêntico ao inexistente, nunca 500).

**Patch mínimo proposto (não aplicado):** repetir a guarda já usada no `GET` da mesma rota
(`label.controller.ts:210-213`) antes do `authorizeContactResource`:

```ts
const [contactRow] = await db
  .select({ id: schema.contacts.id })
  .from(schema.contacts)
  .where(eq(schema.contacts.id, id));
if (!contactRow) {
  return reply.status(404).send({ error: 'NOT_FOUND', message: 'Contact not found' });
}
```

---

## D3 — Contato de setor alheio entra no grupo (`POST /contact-groups/:id/members` → 201)

**Repro:** ator com membership `write` no setor A; contato vinculado somente ao setor B:
`POST /contact-groups/<grupo do setor A>/members {contactId: <contato de B>}` → `201 {"added":true}`.

**Causa:** o handler (`modules/contact-groups/src/presentation/http/contact-group.controller.ts:178`)
autoriza apenas o **grupo** (`authorizeGroup`, `:189`) e delega ao repositório
(`contact-group.repository.ts:59`); o contato nunca é autorizado (AC2 exige
autorização por contato/setor).

**Impacto:** AC2 — vínculo a contato inacessível aceito; combinado com D6, vira vazamento
de PII de outro setor.

**Patch mínimo proposto (não aplicado):** após `authorizeGroup`, autorizar o contato
(o helper `contactSectorIds` já existe no arquivo, `:77`; `authorizeContactResource` já é
importado de `@cvg/auth`, `:6`):

```ts
const [contactRow] = await db
  .select({ id: schema.contacts.id })
  .from(schema.contacts)
  .where(eq(schema.contacts.id, contactId));
if (!contactRow) {
  return reply.status(404).send({ error: 'NOT_FOUND', message: 'Contact not found' });
}
const contactAccess = await authorizeContactResource({
  actor: request.user,
  action: 'contacts:write',
  contact: { id: contactId, sectorIds: await contactSectorIds(contactId) },
  requiredLevel: 'write',
});
if (!contactAccess.allowed) {
  return reply.status(contactAccess.statusCode).send({ error: contactAccess.error, message: contactAccess.message });
}
```

---

## D4 — Remover contato de setor alheio é aceito (`DELETE .../members/:contactId` → 200 e apaga)

**Repro:** linha `contact_group_members` pré-existente (contato do setor B no grupo do setor A);
`DELETE /contact-groups/<grupo A>/members/<contato B>` com ator `write` em A →
`200 {"removed":true}` e a linha é apagada.

**Causa:** mesmo padrão de D3 no handler `contact-group.controller.ts:207` →
`contact-group.repository.ts:67` (`removeMember`).

**Impacto:** AC2 ("desvinculam contatos com autorização por contato/setor").

**Patch mínimo proposto:** aplicar a mesma guarda de D3 antes de `removeGroupMember`.

---

## D5 — Rota de desvínculo de etiqueta de contato ausente

**Repro:** `DELETE /contacts/<contato próprio>/labels/<label>` →
`404 {"message":"Route DELETE:/contacts/:id/labels/:labelId not found","error":"Not Found","statusCode":404}`.

**Causa:** o repositório e o caso de uso existem
(`modules/labels/src/infrastructure/repositories/label.repository.ts:88`,
`modules/labels/src/application/use-cases/index.ts:70` — `removeContactLabel`), mas nenhuma
rota os expõe: `label.controller.ts` registra apenas `GET`/`POST` de contato (`:200`, `:230`)
e `DELETE /conversations/:id/labels/:labelId` (`:174`). Não há histórico de rota removida
(`git log -S "contacts/:id/labels/:labelId"` vazio) — é lacuna original.

**Impacto:** AC2 exige que etiquetas **desvinculem** contatos; a amostragem
"attach/detach de contato alheio negado / próprio permitido" não é executável sem a rota.

**Patch mínimo proposto (não aplicado):** adicionar a rota espelhando a de conversa
(`:174-197`), com existência + `authorizeContactResource` (`action: 'contacts:write'`,
`requiredLevel: 'write'`) e `useCases.removeContactLabel(id, labelId)`.

---

## D6 — `GET /contact-groups/:id/members` expõe PII de contato fora do escopo (AC3)

**Repro:** linha `contact_group_members` com contato do setor B em grupo do setor A;
`GET /contact-groups/<grupo A>/members` com ator `write` em A → 200 contendo
`contactId`, `contactName`, `contactPhone` (e `contactEmail`) do contato de B.

**Causa:** a listagem autoriza apenas o grupo (`contact-group.controller.ts:153-170`,
`authorizeGroup`) e o repositório junta `contacts` sem filtro de acesso
(`contact-group.repository.ts:45-57`). O mesmo vale para `memberCount` no catálogo
(`:7-18`), que conta linhas não visíveis.

**Impacto:** AC3 ("listagens/detalhes não vazam existência nem conteúdo fora do escopo;
contagens/limit consistentes") — vazamento de nome/telefone entre setores.

**Patch mínimo proposto (não aplicado):** filtrar os membros com o mesmo
`authorizeContactResource` (`action: 'contacts:read'`, `requiredLevel: 'read'`, com
`contactSectorIds`) antes de responder; e, para manter a contagem consistente, recalcular
`memberCount` do catálogo a partir dos membros visíveis ao ator (mesmo filtro). A decisão de
como contar dados legados é de produto; o teste exige que **listagem e contagem contem a
mesma coisa para o mesmo ator**.

---

## Observações de escopo

- `GET /contacts/:id/labels` (detalhe) já retorna 404 idêntico para contato alheio e
  inexistente — coberto por SA-013 caso 8; sem regressão.
- A política de contato **sem** vínculo (visível a autenticado com `chat:read`) é vigente e
  está em D01 OPEN (`AUTORIZACAO-MATRIZ.md` §4.1/§9); o teste novo não a altera nem a
  questiona.
- `GET /labels` continua catálogo global do tenant (D01 OPEN, matriz §"Lacunas de escopo");
  fora do escopo deste teste.
