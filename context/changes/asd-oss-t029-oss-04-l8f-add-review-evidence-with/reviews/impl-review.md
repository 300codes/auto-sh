<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: OSS-04 (L8f) review evidence, verified / changes_requested transitions and correction limit

- **Plan**: context/changes/asd-oss-t029-oss-04-l8f-add-review-evidence-with/plan.md
- **Scope**: Phase 1–2 of 2 (full plan)
- **Date**: 2026-09-19
- **Verdict**: APPROVED (after fixes)
- **Findings**: 0 critical, 2 warnings, 6 observations
- **Mode**: drift check by the implementer against the plan; independent safety / quality / pattern read by one reviewer agent given the code, not the conclusions (memory budget of the machine: one agent, no builds inside it)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (every planned change present; D1–D15 implemented; nothing planned is missing) |
| Scope Discipline | PASS (only the two planned refactors `assertTaskPins`, `requireVerifiedBaselineContent`; no migration / error code / schema change) |
| Safety & Quality | WARNING (F1, F2 accepted with notes) |
| Architecture | PASS (lock order project → project tasks as `reconcile.ts`; all reads before the first mutation; scoped queries) |
| Pattern Consistency | PASS (F5 fixed) |
| Success Criteria | PASS (2.1–2.4 green; 2.5 manual, left open) |

## Findings

### F1 — Review is gated by `delivery_os.results.import` only

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; ACL ids are a contract surface
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/modules/delivery_os/api/projects/[id]/evidence/route.ts:28
- **Detail**: A result-importer credential can post an approved review and verify a task, or block it at the correction limit, while `PUT /tasks` needs `projects.manage`.
- **Fix A**: require `delivery_os.projects.manage` for `kind: 'review'`. Strength: separates importer and reviewer. Tradeoff: deviates from the frozen route table (R19 → `results.import`, defined as "import results, record evidence"); seeded roles are unchanged either way (employee has both). Confidence: MED. Blind spot: EXEC's reviewer agent runs under which feature set.
- **Fix B ⭐ Recommended**: keep the frozen contract; the gate stays the deterministic proof (an approval without proof is refused whoever sends it); record a dedicated review feature as an ACL-contract question for a human (OSS-06 / enterprise).
- **Decision**: ACCEPTED — Fix B. The spec pins R19 to `results.import` and ACL ids are a contract surface ("ask before changing public contracts"). Noted in the hand-over.

### F2 — `reviewer.kind = 'human'` is trusted from the body under any user session

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/modules/delivery_os/commands/evidence.ts (`assertReviewer`)
- **Detail**: An AI tool call running under a user session could post `manualCheckId` + `reviewer.kind: 'human'` and prove a manual AC.
- **Fix**: derive "human" from the request context, or have agent tool packs set `reviewer.kind = 'agent'` server-side.
- **Decision**: ACCEPTED — plan decision D6 (a signed-in user id is the accountability anchor; `recordedBy` names the user). Patch request for the AI tool pack (force `reviewer.kind: 'agent'`, route manual checks through the human approval flow) added to the hand-over.

### F3 — Replay answered before the reviewer check

- **Severity**: ℹ️ OBSERVATION · **Impact**: 🏃 LOW · **Dimension**: Plan Adherence · **Location**: commands/evidence.ts (`recordReviewInTransaction`)
- **Detail**: An identical replay of a human review answered 200 without a signed-in user.
- **Fix**: call `assertReviewer` before the replay lookup (pure, no I/O).
- **Decision**: FIXED (+ test "needs a signed-in user…" covers the replay).

### F4 — `attemptId` ignored when picking the accepted result

- **Severity**: ℹ️ OBSERVATION · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality · **Location**: commands/evidence.ts (`findAcceptedResult`)
- **Fix**: with an `attemptId`, use the newest result of that attempt.
- **Decision**: FIXED (+ test "reviews the result of the named attempt").

### F5 — Unreachable 409 wording in the OpenAPI doc

- **Severity**: ℹ️ OBSERVATION · **Impact**: 🏃 LOW · **Dimension**: Pattern Consistency · **Location**: api/projects/[id]/evidence/route.ts
- **Decision**: FIXED (clause removed).

### F6 — Ties on `createdAt` order by random id

- **Severity**: ℹ️ OBSERVATION · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality
- **Decision**: SKIPPED — writers are serialized by the project lock; already noted in the plan (F3 of the plan review).

### F7 — Test gaps (409 matrix, other-baseline project rows, review with attemptId)

- **Severity**: ℹ️ OBSERVATION · **Impact**: 🏃 LOW · **Dimension**: Success Criteria
- **Decision**: FIXED — `draft` / `cancelled` added to the matrix; other-baseline project-level row case; attemptId case.

### F8 — `taskStatusReason` typed `string | null`

- **Severity**: ℹ️ OBSERVATION · **Impact**: 🏃 LOW · **Dimension**: Pattern Consistency
- **Decision**: DISMISSED — the entity column and `AttemptReconcileResult` use `string | null`; tightening breaks the assignment from the entity.

## Success criteria after fixes

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 45 suites, 1116 tests green
- `npx tsc --noEmit` (packages/core) → clean; eslint on touched files → clean
- Live API flow on localhost:3100 → see hand-over Evidence (run before F3/F4/F7; both fixes are covered by unit tests, the live paths are unchanged)
- 2.5 Manual → open (human)
