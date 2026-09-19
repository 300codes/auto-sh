<!-- PLAN-REVIEW-REPORT -->
# Plan Review: FLOW-F1 L13a — Intake and Flow-Pin Commands

- **Plan**: context/changes/asd-oss-t044-flow-f1-l13a-add-intake-and-flow-pin/plan.md
- **Mode**: Deep (self-review in autonomous mode; grounding done from the same session's reads)
- **Date**: 2026-09-19
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
10/10 paths ✓, 6/6 symbols ✓ (`hashFlowTemplate`, `getBuiltInFlowTemplate`, `mergeScopingProposal`, `applyIntakeUpdate`, `verifyAttachmentReferences`, `isIssuedTrustedExecution`), brief↔plan ✓

## Findings

### F1 — Pin replay must not depend on the live provider

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 — Flow commands, F4 ordering
- **Detail**: The plan resolves the provider and checks the hash before the lock for every call. Spec D7 says the snapshot is the truth and "same template again → 200 same body"; if Marcin's provider later changes or drops `delivery-default@1`, a legitimate replay would answer 422 instead of the stored body. Also the row lock would be held while an external provider does I/O.
- **Fix**: Replay-before-lock like F3: unlocked project read → pinned with same id+version → stored body (`duplicate: true`) without consulting the provider; pinned with another → 409; unpinned → provider lookup + hash checks, then tx with `lockProjectForWrite` re-checking the pin state under the lock (same rules).
  - Strength: Snapshot wins over the live template; no provider I/O under a row lock.
  - Tradeoff: One extra unlocked read.
  - Confidence: HIGH — same shape as baselines/planImport replay.
  - Blind spot: None significant.
- **Decision**: FIXED

### F2 — F3 result must follow the locked outcome, not the probe

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Intake commands, F3
- **Detail**: Two concurrent imports of the same manifest: both probes say "new", the second one under the lock finds the first's manifest and `mergeScopingProposal` returns `duplicate: true`. The plan does not say the response is then the duplicate shape.
- **Fix**: State that the transaction outcome is authoritative: `duplicate: true` from the locked merge returns the replay shape and writes nothing; a conflict raises 409.
- **Decision**: FIXED

### F3 — Phase 2 text contains unresolved self-talk

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — §2 Intent and Contract
- **Detail**: "F2 strips nothing itself — … No:" and "snapshotAfter … No:" read as open questions. The decisions are actually settled (zod strips `proposals`; audit snapshots carry no PII).
- **Fix**: Rewrite both sentences as statements.
- **Decision**: FIXED

### F4 — Trusted import audit actor

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — F3 buildLog
- **Detail**: An in-process trusted import has no `ctx.auth.sub`; `attempts.ts:409` stamps `actorUserId` from `trustedExecution.actorUserId`. The plan does not mention it.
- **Fix**: `buildLog` copies `trustedExecution.actorUserId` when present, like the internal attempt commands; `createdBy` on a lazily created intake row uses `ctx.auth.sub` when parseable, else the trusted actor, else null.
- **Decision**: FIXED

### F5 — appendOnly variable-name regex

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2/3 — new command files
- **Detail**: `appendOnly.test.ts` flags any property assignment on a variable whose name contains `aseline`, `vidence` or `ecision`. New files must not name locals like `decisionRow.x = …`; none are planned, noted so the implementer avoids it.
- **Fix**: Add to Critical Implementation Details.
- **Decision**: FIXED
