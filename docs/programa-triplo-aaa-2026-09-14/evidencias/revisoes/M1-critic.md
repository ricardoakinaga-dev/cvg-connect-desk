# M1 — Independent Critic Report (SA-001..SA-010)

> Persisted by the lead from the fresh-context critic's inline delivery. The critic harness exposed only read-only tools, so it could not write this file itself. Content is verbatim in substance; formatting normalized to Markdown only.

## Candidate
`HEAD 754f9badac46278e77d21de91c58eedb15e80581` + worktree (SA-001 manifest labels it 493/494 entries — see Finding F5).

## Independence statement
I am a fresh-context, same-model-family, shared-filesystem reviewer (**I1**). I have no Builder history, did not read `.gauntlet/` or any Builder rationale, and did not use prose from other agents as evidence. Every verdict below comes from direct inspection of the named files/artifacts, cross-checked where possible against the prior audit's `source-manifest.json` hashes. I could not execute the two permitted re-runs (no shell tool in this harness); all verification is static, and runtime artifacts are trusted only as recorded.

## Per-task verdicts

| Task | Verdict | Basis inspected |
|---|---|---|
| SA-001 | **PARTIAL** | Manifest/revalidation/environment inspected; A01/A02/A03/A06/A07 hash-identical to audit baseline; AC1 diff/tracked-untracked inventory incomplete; counts inconsistent (F5) |
| SA-002 | **NOT REFUTED** | `frozen-denominators.json` shared `[85,80,85,85]` matches `packages/shared/vitest.config.ts:14-19`; C-1/D-1/QB-1 present; D01–D06 all OPEN (F7 Low) |
| SA-003 | **NOT REFUTED** (static) | Runner + storage env + selfcheck guards, exclusive ports/projects, scoped teardown, sanitization; selfcheck JSON records 5/5 PASS; could not re-run (F10 Low) |
| SA-004 | **NOT REFUTED** | `toPublicUser` used by GET detail/POST/PUT; list projects fields; 5-case HTTP test with real PG; audit newValue has no hash |
| SA-005 | **PARTIAL** | `moveConversation` is one transaction with history/audit/outbox/hints-after-commit; but the "last write" failure injection does not exist (F1) |
| SA-006 | **NOT REFUTED** | Transactional user use-cases; forced audit-trigger failure rolls back; revocation changes live session; concurrency without duplicates |
| SA-007 | **NOT REFUTED** | `startConversation` single tx (conversation+history+audit+outbox), contact `FOR UPDATE`; 5 concurrent POSTs converge; audit-failure rollback test |
| SA-008 | **PARTIAL** | Server filters + UI wiring real; but no browser+real-API proof, UI test mocks the API, back/refresh untested (F3) |
| SA-009 | **PARTIAL** | Compose DATABASE_URL/`USE_DATABASE_OUTBOX="true"` + fail-fast + pool handler verified; boot artifact lacks build step, has 15 checks (not 16), and no positive WS/cross-access proof (F2) |
| SA-010 | **PARTIAL** | Strict verifier rejects all 5 adversarial cases + 24 checks PASS; but DLQ→event relation is never exercised (F4) |

## Findings (largest material gap first)

**F1 — HIGH — SA-005/G03: the required "failure in the last write" is never injected.**
`modules/chat/src/application/use-cases/conversation-operations.use-case.ts` validates the assignee *before* the only `UPDATE`. The test `apps/desk-api/src/__tests__/sa-005-kanban-atomic.integration.test.ts` sends `assignedUserId: randomUUID()`, so the request fails at validation with zero writes; it would pass even if all writes were non-transactional. `evidencias/SA-005/evidence.jsonl` claims the failure is "no último passo do tx" — that is inaccurate. SA-006/SA-007 use BEFORE-INSERT triggers on `audit_logs`; SA-005 does not.

**F2 — HIGH — SA-009/G09: boot evidence does not tie the image to the candidate revision and omits AC2's positive WS/cross-access proof.**
`scripts/production/sa-009-realtime-boot.ts` records a `build_imagem` check unless `--skip-build`. `evidencias/SA-009/sa-009-boot.json` has no such check (the run was `--skip-build`), yet `evidencias/SA-009/evidence.jsonl` records the command without `--skip-build`. The image digest `sha256:dbc2307…` is therefore not evidenced as built from the current worktree. Additionally, `sa-009-boot.json` contains **15** checks, not the 16 claimed, and the only WS case is anonymous refusal; SA-009-AC2 ("subscrição/delivery autorizada funcionam; acesso cruzado é recusado") is deferred to SA-052 — i.e., not proven in this task.

**F3 — HIGH — SA-008/AC2: no browser+real-API proof; JSdom test mocks the API.**
`apps/desk-web/src/__tests__/sa-008-context.test.tsx` mocks `../lib/api` entirely, so it proves call shape, not end-to-end delivery; back/refresh are not exercised (only `MemoryRouter` initial deep-links). `evidencias/SA-008/evidence.jsonl` admits the real-browser proof is deferred to SA-049/SA-058, while AC2 requires "browser+API" and "back/refresh/deep-link".

**F4 — MEDIUM — SA-010/AC1: the DLQ→outbox relation is not verified.**
`infra/scripts/dr-verify-fixture.mjs` checks only DLQ presence plus `consumer_id`/`event_type`. The fixture creates `dead_letter_events.original_event_id = "${tag}-dlq"`, which references no restored outbox event (`"${tag}-evt"`). The restored relation DLQ→event is never compared, contrary to the objective "todas as entidades e relações necessárias".

**F5 — MEDIUM — SA-001/AC1: manifest is aggregate-only for diff/tracked-vs-untracked, and counts disagree across artifacts.**
`scripts/programa-triplo-aaa/candidate_manifest.py` records only `diff_stat_tail`, `modified_tracked_count` and `untracked_count`; inventory entries carry no tracked/untracked or per-file diff flag. `candidate-manifest.json` says `status_entry_count: 494`, `untracked_count: 9828`; `environment.json` says `worktree_entries: 493`, `untracked: 231`; `findings-revalidation.md` and every `evidence.jsonl` use "worktree-493". The unit difference is never explained and the candidate id is off by one. (Positive: the manifest hashes for the code findings equal the audit `source-manifest.json` hashes, corroborating "A01–A10 unchanged at freeze".)

**F6 — LOW — SA-005/AC1: reopening to `novo` is rejected.**
`CONVERSATION_TRANSITIONS`: `finalizado → ['em_atendimento','arquivado']`, `arquivado → ['em_atendimento']`; `kanban.controller.ts` accepts `novo` in the body schema. AC1 wording includes `novo/em_atendimento`; CONTRATOS.md only fixes the `em_atendimento` example. Clarify policy (test or contract note).

**F7 — LOW — SA-002/AC1: G01–G12 lack explicit version/owner/inputs-outputs/examples in `CRITERIOS.md`**; owners exist only indirectly via `RASTREABILIDADE.md`. C01–C10 satisfy the structure.

**F8 — LOW — SA-002 and SA-010 evidence dirs have no `evidence.jsonl`**, so AC/gate/command/tool/attempt/limits/critic fields required by `CRITERIOS.md` are not uniformly recorded.

**F9 — LOW — SA-004/AC3 logs assertion untested**; static inspection of `admin.controller.ts` shows only error objects logged, no hash path found.

**F10 — LOW — SA-003/AC3:** the negative self-test is a failing command after provisioning, not a service-start failure; ClamAV was not exercised (documented). Cleanup-on-failure is otherwise demonstrated.

## REVIEW_RESULT: APPROVED_WITH_FINDINGS

No REFUTED item and no observed wrong product behavior; the fixes are structurally present and the strong tests (SA-004, SA-006, SA-007, SA-010 adversarial) hold. The gaps are evidence/proof completeness against explicit acceptance criteria (mostly G02/G03/G09/G12), not demonstrated regressions.

### Required corrections
1. SA-005: inject a genuine post-write failure (trigger on `outbox_events`/`audit_logs` for the Kanban move) and assert no partial state; correct the `evidence.jsonl` wording.
2. SA-009: re-run the boot without `--skip-build` (or record build+digest provenance), correct "16 checks" to 15, and add the positive authorized WS delivery plus cross-access refusal against the delivered image — or record SA-009-AC2 as partially deferred.
3. SA-008: add the real-browser + real-API two-conversation fixture with back/refresh (Playwright), or record AC2 as PARTIAL.
4. SA-010: set the DLQ fixture `original_event_id` to the outbox `event_id` and assert that relation in the verifier.
5. SA-001: either add per-file tracked/untracked/diff status or document the deliberate aggregate; reconcile 493/494 and 231/9828 across artifacts.
6. Low: document the `novo` reopen policy; complete G-gate ownership/IO/examples (or point to RASTREABILIDADE); add `evidence.jsonl` for SA-002/SA-010; extend SA-003's negative case to a provisioning/startup failure.

## Files the critic could not verify
- Any runtime state: live PIDs, `/tmp/cvg-aaa-runs`, Docker images/containers, `git status`, current file SHA-256 recomputation (no shell/hash tool). The SA-009 image digest could not be tied to the worktree.
- The two permitted re-runs (storage selfcheck; `sa-008-context.test.tsx`) were **not executed**.
- It could not write this file (no write tool).

## Executed vs inspected
The critic executed no commands: all verification was static inspection of real files. It read SA-001/002/003/004/005/006/007/008/009/010 evidence and sources, cross-compared nine manifest hashes against the prior audit's `source-manifest.json` (all equal), and confirmed there are no remaining live callers of the non-atomic `updateStatusV2`/`updateSector`/`assignUser`/`assignRoles` paths in the working tree. It mutated nothing.
