<!-- PLAN-REVIEW-REPORT -->
# Plan Review: FLOW-F1 L13c — Flow Gate on v1 Ready, Reserve and Deploy

- **Plan**: context/changes/asd-oss-t046-flow-f1-l13c-enforce-the-flow-gate-o/plan.md
- **Mode**: Quick (grounding + blast-radius greps in-process; no sub-agent — memory rule)
- **Date**: 2026-09-19
- **Verdict**: SOUND (after F1 accepted with a test)
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | PASS |
| Plan Completeness | PASS |

## Grounding
6/6 existing paths ✓ (flowGate.ts is new), 3/3 symbols ✓ (`flowTemplateV1Schema`, `FLOW_APPROVAL_STAGE_ORDER`, `buildDeliveryError`), brief↔plan ✓

## Findings

### F1 — `checkReadyGate` has a second caller: `commands/reconcile.ts:88`
- **Severity**: ⚠️ WARNING · **Impact**: 🔎 MEDIUM · **Dimension**: Architectural Fitness · **Location**: Phase 1 §3
- **Detail**: Reconciling an attempt (`not_started`/`unknown` resolution) re-derives readiness through `checkReadyGate` and lands the task in `blocked` when readiness fails. With the gate inside `checkReadyGate`, a pinned project whose Scope changed after dispatch reconciles its task to `blocked` instead of `ready`.
- **Fix**: Keep the gate inside `checkReadyGate` (same server-side readiness for every path; a task must not become dispatchable again while upstream approvals are stale — addendum "aktywne próby trzeba zatrzymać/uzgodnić") and add one `flowGate.test.ts` case: reconcile `not_started` on the gated project → task `blocked`, statusReason null.
- **Decision**: FIXED (plan Phase 2 §1 gains the reconcile case; Phase 1 §3 notes the second caller)

### F2 — Deploy gate placed after `report_not_green`
- **Severity**: ℹ️ OBSERVATION · **Impact**: 🏃 LOW · **Dimension**: Blind Spots · **Location**: Phase 1 §5
- **Detail**: On a pinned project without evidence the v1 `report_not_green` wins over the flow gate. Consistent with "v1 errors keep priority"; the flowGate test seeds green evidence so the gate is observable.
- **Decision**: ACCEPTED

### F3 — Required stages from the snapshot vs F6 status using all four
- **Severity**: ℹ️ OBSERVATION · **Impact**: 🏃 LOW · **Dimension**: Architectural Fitness · **Location**: Key Discoveries
- **Detail**: `lib/flowStatus.ts#gateFrom` calls `checkFlowGate(states)` with the default four stages; the command gate uses the snapshot's approval stages. Identical for `delivery-default@1`; for a template that drops a stage the gate is never stricter than F6. Recorded in the hand-over for the F6 owner (same file, later layer).
- **Decision**: SUPERSEDED — impl-review F1: `flowTemplateV1Schema` requires exactly one stage per approval kind, so the gate now passes `FLOW_APPROVAL_STAGE_ORDER` directly and matches F6 exactly.

### F4 — Replay of an existing reservation bypasses the gate by design
- **Severity**: ℹ️ OBSERVATION · **Impact**: 🏃 LOW · **Dimension**: Blind Spots · **Location**: Phase 1 §4
- **Detail**: `reserve` returns the existing attempt for a replayed key before the lock and the gate. That attempt was gated when created; replay is a read (R14 contract). Not a bypass: F7 refuses a new artifact while the attempt is active.
- **Decision**: ACCEPTED
