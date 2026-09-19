<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: FLOW-F1 L13c — Flow Gate on v1 Ready, Reserve and Deploy

- **Plan**: context/changes/asd-oss-t046-flow-f1-l13c-enforce-the-flow-gate-o/plan.md
- **Scope**: Phases 1–3 of 3 (all automated rows done; Manual 3.3 pending for a human)
- **Date**: 2026-09-19
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Drift check (working tree vs plan): `flowGate.ts` new; `stages.ts` uses the shared loaders (−43/+9 lines, no behaviour change); one additive gate line in `tasks.ts#checkReadyGate`, `attempts.ts` reserve (placed after the reservation validation throw and before the register write — v1 errors keep priority) and `decisions.ts` deploy `approved`; two new suites; spec changelog; running hand-over. No unplanned files. Independent safety/pattern review (sub-agent, unanchored): tenant/org scoping on every query, gate after locks and before writes, replay path not a bypass, unreadable snapshot fails closed, `appendOnly`/`scopeChange` scanners satisfied, no `any`/one-letter names/inline comments — verdict APPROVED.

Success criteria run: `jest src/modules/delivery_os --maxWorkers=2` → 83 suites / 1627 tests green (before the F1 cleanup; affected suites re-run after: 3 suites / 39 tests green); `turbo run typecheck --filter=@open-mercato/core --concurrency=2` green; eslint on touched files clean; `grep flowTemplateId commands/*.ts` → gate key only in `flowGate.ts` (`flow.ts` is the pin command's own read/write).

## Findings

### F1 — `flowGateStages` filter was dead code and its test used an unrepresentable template

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: packages/core/src/modules/delivery_os/commands/flowGate.ts (former `flowGateStages`)
- **Detail**: `flowTemplateV1Schema` requires exactly one stage of each approval kind, so filtering `FLOW_APPROVAL_STAGE_ORDER` by the snapshot could never remove a stage; the test case with a template lacking `key_visual` exercised a shape the schema forbids, and the plan-review F3 concern (command gate vs F6 list) was moot.
- **Fix**: Pass `FLOW_APPROVAL_STAGE_ORDER` directly (identical to `lib/flowStatus.ts#gateFrom`), delete the helper and the test case, align spec/hand-over/plan wording.
- **Decision**: FIXED
