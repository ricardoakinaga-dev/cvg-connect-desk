# M1 — Targeted Re-Review of Corrections (F1/F2/F4/F5/F6/F7/F10)

> Persisted by the lead from the fresh-context critic's inline delivery. The critic harness exposed only read-only tools and could not write files. Content is verbatim in substance; formatting normalized.

## Independence statement (I1)
Fresh context, same-model family, shared filesystem. No builder history, no prior conversation. All verdicts from direct static inspection of the named files. No shell/execution available; runtime claims cross-read from persisted artifacts and the code paths that produced them. Nothing mutated.

Scope note: **F3 (SA-008 browser proof) and F9 (SA-004 logs) were not re-adjudicated here.** F8 is partially addressed (SA-002/SA-010 `evidence.jsonl` now exist).

## Verdicts

| Correction | Verdict | Notes |
|---|---|---|
| F1 — SA-005 genuine last-write failure | **CORRECTED** | Trigger on `audit_logs` for `conversation.kanban.moved` fires after entity/history/outbox writes (audit is the last DB write). Residual overclaim about "atribuição" was fixed in the follow-up (payload now includes `assignedUserId` and asserts assignment rollback). |
| F2 — SA-009 build provenance + positive WS | **CORRECTED** | Artifact has 20 checks including `build_imagem` (exit 0), image `sha256:dbc2307…634c`, `desk_api_real_pronta`, positive WS auth/subscribe/delivery and cross-access refusal. WS positive path uses a real session row + real `/auth/me` via `DESK_API_URL`; refusal asserts an error containing conversation B's id. Evidence metadata was corrected in the follow-up to match the `sa009-verified` run. |
| F4 — SA-010 DLQ→event relation | **CORRECTED** | `vinculo_dlq_evento` compares `dlq.original_event_id` to `event.event_id`; `dr-e2e.sh` links DLQ to `<tag>-evt`; adversarial case `vinculo_dlq_trocado_reprova` present. Follow-up hardened the selection (tag-pattern + consumer/type) so the check is falsifiable, and fixed the swap UPDATE to match the real row. |
| F5 — SA-001 manifest per-file status + counts | **CORRECTED** | `git_state`/`diff_status` per entry, `counts` block with definitions; `environment.json` reconciles 493/510 and 231/9828; revalidation header no longer asserts "now 493". Candidate id normalized to `754f9bad+worktree` in all evidence records (follow-up). |
| F7/F6/F10 (low) | **CORRECTED** | G01–G12 ownership/IO/examples table (G-1) in CRITERIOS.md; reopen policy documented (409 for direct `novo`); provisioning-failure self-check 4/4 PASS with foreign process intact and no own data dir. |

## Findings raised by this pass (all resolved by the lead before promotion)
1. SA-009 evidence record contradicted its artifact (exit status/run id/timestamps) — **fixed** (`sa009-verified`, exit 0, aligned window).
2. SA-005 evidence timestamps didn't match the referenced runner summary — **fixed** (aligned to 01:44:43–01:44:50Z run).
3. SA-005 F1 wording overclaim ("atribuição") — **fixed** (assignment now exercised and asserted).
4. SA-010 evidence timestamps off by ~2 min — **fixed**.
5. F4 tautology/no-op — **fixed** (falsifiable selection; swap matches real row).
6. Candidate-id label drift — **fixed** (all records use the canonical id).

## REVIEW_RESULT: APPROVED_WITH_FINDINGS (all findings resolved in follow-up)

All listed corrections were present and substantively effective at review time; no product behavior was refuted and no mutation was observed. The remaining issues were evidence-record coherence and were fixed before promotion to DONE.

## Static limits
The critic could not recompute the image digest, inspect runtime state, or re-run tests; it confirmed the build script derives from the candidate repo and records `git rev-parse HEAD` plus `build_imagem`. It noted no mutation of the candidate.
