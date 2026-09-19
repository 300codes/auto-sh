# OSS-03 (L7e): prove scope-change and immutability rules — Plan Brief

> Full plan: `context/changes/asd-oss-t023-oss-03-l7e-prove-scope-change-and-im/plan.md`

## What & Why

OSS-03 promised that an approved baseline never changes, that a scope change starts a new version with old work pinned
to the old one, and that "the agent proposes, the system decides" (no silent approvals, no late results leaking into the
new scope). This change turns those promises (master-plan 3.1/3.2) into one auditable test file and hands the real API
to QA/UI at H14.

## Starting Point

All six rules look guarded in code from T001–T022 (append-only commands, `baseline_not_active`, `subject_hash_mismatch`,
project lock on decisions, baseline-scoped projections), but the proofs are scattered or missing.

## Desired End State

`scopeChange.test.ts` fails if any rule regresses; the module gate is green; R7 + R10 are smoked live; the H14
hand-over lists bodies, codes, headers and evidence rows.

## Key Decisions Made

| Decision | Choice | Why |
|---|---|---|
| Route immutability proof | static scan of every module `route.ts` | covers future routes, no Next handler imports |
| Command immutability proof | pin the full delivery_os command id set | adding an update/delete fails loudly |
| Late result | accepted as v1 evidence, v2 relabel rejected, projections ignore it | matches lifecycle "old result does not credit new" |
| Reserve on superseded | existing `422 baseline_not_active`, no code change | guard already present |
| No timeout approval | source scan: decisions created only by the human command | structural, not time-based |
| Schema proof | chain requirements→plan and manual in one harness | shows both inputs end on one schema |

## Scope

**In scope:** one test file, fixes only if a rule fails, capped gate, live smoke, hand-over, spec changelog line.

**Out of scope:** new routes/events/ACL/migrations, OSS-05 evidence API, master-plan Progress edits.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Test file | rules (1)–(6) proven | fixture AC ids may not chain requirements→plan (fallback: independent seeds) |
| 2. Gate + smoke + hand-over | evidence for 3.1–3.3, 3.6 | core typecheck/dev server memory (run one heavy command at a time) |

**Prerequisites:** dev server on :3100 (restart after a standalone core build if stale).
**Estimated effort:** one session.

## Open Risks & Assumptions

- UI-03 confirms the OSS-frozen proposal contracts (Requirements/Plan proposal v1) — listed as an assumption in the hand-over.

## Success Criteria (Summary)

- A regression in any of the six rules turns the suite red.
- QA/UI can call R6–R10 from the hand-over alone.
