<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: FLOW-F0 contract delta

- **Plan**: context/changes/asd-oss-t040-flow-f0-publish-the-versioned-contra/plan.md
- **Scope**: full plan (Phases 1–3)
- **Date**: 2026-09-19
- **Verdict**: APPROVED after fixes (was NEEDS ATTENTION)
- **Findings**: 0 critical, 3 warnings, 6 observations (one independent review agent + author triage; autonomous mode)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS (flowRules.ts/flowTemplates.ts are pure lib additions the plan named under D5/D6; no route/command/migration) |
| Safety & Quality | PASS after F1/F2 |
| Architecture | PASS after F9 |
| Pattern Consistency | PASS |
| Success Criteria | PASS (automated); 2.3 manual pending |

## Findings

### F1 — Template stageId and kind treated as the same string
- **Severity**: ⚠️ WARNING · **Impact**: 🔎 MEDIUM · **Dimension**: Safety & Quality · **Location**: lib/contracts.ts (flowTemplateV1Schema), lib/flowRules.ts
- **Detail**: A template `{ stageId: 'ux-figma', kind: 'ux' }` passed the schema while `computeStageCurrency` resolved dependencies by kind, silently dropping the upstream check.
- **Fix**: refinement now requires exactly one stage per approval kind with `stageId === kind`; test added.
- **Decision**: FIXED

### F2 — approvedArtifact ignored client approval
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality · **Location**: lib/flowRules.ts#lastApprovedArtifact
- **Fix**: `isEffectiveApproval` honours `requiresClientApproval`; test asserts `approvedArtifact` is null.
- **Decision**: FIXED

### F3 — Spec F10 named the internal staff helper `assertProjectAccess`
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Architecture · **Location**: spec § Operations F10
- **Fix**: spec now uses only the DI resolver result (`canManageAll || projectIds`).
- **Decision**: FIXED

### F4 — Unbound upstream reported as `upstream_not_approved`
- **Severity**: ℹ️ OBSERVATION · **Fix**: emits `upstream_stale` when the upstream is approved but not bound; test added. · **Decision**: FIXED

### F5 — Response arrays without bounds (`commentImportResultSchema.threads[].replies`)
- **Severity**: ℹ️ OBSERVATION · **Fix**: `.max(500)` added. `staffLinkSchema.syncCursors` stays a per-file record (response only). · **Decision**: FIXED (partial, accepted)

### F6 — `stage_unknown` for a body stageId vs path stageId
- **Severity**: ℹ️ OBSERVATION · **Fix**: spec states the path check (`422 stage_unknown`) runs before body parsing; body shape errors stay `400`. · **Decision**: FIXED (spec)

### F7 — F9/F12 list schemas not exported
- **Severity**: ℹ️ OBSERVATION · **Fix**: spec marks them as F1/F2 exports by name. · **Decision**: FIXED (spec)

### F8 — Legacy gate semantics diverged between prose, helper and test example
- **Severity**: ℹ️ OBSERVATION · **Fix**: prose clarified (top-level blocker informational, gates open); test example aligned. · **Decision**: FIXED

### F9 — Missing-approval-stage refinement reuses `stage_unknown`
- **Severity**: ℹ️ OBSERVATION · **Decision**: ACCEPTED (message text is explicit; code reused deliberately to keep the table small)

## Independent reviewer feedback (round 2) — all fixed

- R1 (major) stage blockers must not reuse the frozen `reportGateBlockerSchema.kind` → spec: only in `flow.gate`; v1 gates untouched. FIXED
- R2 (major) F8 idempotency key vs unique index → `Idempotency-Key` + body hash like F11; unique `(project_id, idempotency_key)`; approve → reject → approve is a new row. FIXED
- R3 (minor) v1 routes must answer a v1 code → `checkFlowGate(..., { v1Compatible: true })` → `baseline_not_approved` with stage details; test asserts `deliveryErrorBodySchema` parses it. FIXED
- R4 (minor) template approval-stage order → `foreign_dependency` refinement + test. FIXED
- R5 (minor) `proposals` out of the PUT body → `intakeUpdateRequestSchema` omits it; spec/hand-over say it is server-owned. FIXED
- R6 (minor) gate detail codes → `FLOW_GATE_DETAIL_CODES`; `open_comments` blocker in every decision state + test. FIXED
