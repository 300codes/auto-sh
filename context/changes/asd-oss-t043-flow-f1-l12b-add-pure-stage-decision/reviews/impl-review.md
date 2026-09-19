<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: FLOW-F1 L12b — Pure Stage-Decision and Flow-Status Rules

- **Plan**: context/changes/asd-oss-t043-flow-f1-l12b-add-pure-stage-decision/plan.md
- **Scope**: Phases 1–2 of 2
- **Date**: 2026-09-19
- **Verdict**: APPROVED (after fixes)
- **Findings**: 0 critical, 2 warnings (fixed), 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS (one small additive helper, see F3) |
| Safety & Quality | PASS (after F1) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS — 222 tests across 7 delivery_os suites, scoped tsc clean, eslint clean |

## Findings

### F1 — `gates.*.ok` and `gates.*.blocking` could disagree on reopened comments

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/modules/delivery_os/lib/flowStatus.ts (`gateFrom`)
- **Detail**: `ok` came from `checkFlowGate` (currency only) while `blocking` came from `flowGateBlockers`, which includes `open_comments`. All four stages approved plus a reopened thread produced `{ ok: true, blocking: [open_comments] }`.
- **Fix**: Gate lists exclude `open_comments` (they gate F8 approval only, per D5); the thread stays a top-level blocker. Test added.
- **Decision**: FIXED

### F2 — Replay scope not visible in the input contract

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: stageDecisions.ts (`planStageDecision` input, `findReplayedStageDecision`)
- **Detail**: The unique index is per project; a command loading only the stage's rows would pass planning and hit the index (500 instead of 409).
- **Fix**: Input renamed to `projectDecisions` with JSDoc; L13 must load all project decisions and map a unique-violation race to re-read + replay/409 (hand-over note).
- **Decision**: FIXED

### F3 — F6 and F8 had no shared definition of "open thread"

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: flowStatus.ts / stageDecisions.ts
- **Detail**: F6 took an opaque `openThreadsByStage` count; a route counting differently would contradict F8.
- **Fix**: Exported `countBlockingThreadsByStage(threads, states)` built on `blockingThreadsFor`; the F6 route must use it. Test added.
- **Decision**: FIXED

### F4 — Replay test name did not match its assertion

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Success Criteria
- **Location**: stageDecisions.test.ts
- **Fix**: Renamed to "replay wins over a stale artifact" and added the explicit "replay refused for a caller who lost the approver features → 403" case.
- **Decision**: FIXED

### F5 — Projected currency depends on `now` vs stored `decidedAt`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Location**: stageDecisions.ts (projected decision)
- **Detail**: The response currency projects `{ decidedAt: now }`; the command must persist the same instant it passed as `now` so the stored row and the answer agree.
- **Decision**: ACCEPTED (hand-over note for L13)

### F6 — Legacy `nextAction` relies on `intakeStep: null` when no intake row exists

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Location**: flowStatus.ts (legacy branch)
- **Detail**: F1 synthesises a default intake (`brief`); the F6 route must pass `null` when no row exists, otherwise legacy projects report `pin_template`.
- **Decision**: ACCEPTED (hand-over note for L13)

### F7 — `foreign_reference` 422 for a foreign artifact is not in the spec's F8 error list

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Decision**: ACCEPTED — additive to the F8 row; to be added to the spec when the L13 command lands (consistent with F7/F11).

### F8 — `nextAction` never yields `publish`/`release`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Decision**: ACCEPTED — this module has no deploy/publication input; `dispatch`/`none` is its ceiling. Wiring lands with F14.

## Independent reviewer feedback (round 2) — resolved

### R1 — Deferrals were not hash-bound (major)

- **Location**: stageDecisions.ts (`blockingThreadsFor`, `CommentThreadRecord`), flowStatus.ts (`countBlockingThreadsByStage`)
- **Detail**: any `deferred` thread was non-blocking regardless of which artifact version it was deferred for; a thread deferred on UX v1 no longer blocked UX v2.
- **Fix**: `CommentThreadRecord.deferral: { artifactId, contentHash } | null`; `blockingThreadsFor(threads, stageId, { artifactId, contentHash })` treats a `deferred` thread as non-blocking only when its deferral names the current artifact id **and** hash (`isDeferredFor`). `countBlockingThreadsByStage` passes the current artifact ref. Tests: deferred on v1 blocks v2 (and can be re-deferred on the v2 hash), deferred on the current hash does not block, a `deferred` thread without a deferral record blocks; flow-status count honours the rule.
- **Decision**: FIXED

### R2 — Stored deferredThreadKeys echoed the raw client list (minor)

- **Fix**: `record.deferredThreadKeys` is now exactly the keys that produced a `ThreadDeferral` (documented in the JSDoc and the spec F8 bullet). Test updated.
- **Decision**: FIXED

### R3 — Unbound-thread blocking stricter than the F8 row (minor)

- **Fix**: recorded in the spec: F8 error row and the "Approval interaction" bullet now state that open threads on the stage with `artifactId: null` (version unconfirmed) also block until triaged or deferred, and that `foreign_reference` covers a foreign artifact or an unknown deferred key. Hand-over note for Adam's UI and Figma provider.
- **Decision**: FIXED (documented)
