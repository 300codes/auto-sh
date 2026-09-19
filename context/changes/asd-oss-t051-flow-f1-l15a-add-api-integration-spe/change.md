---
id: asd-oss-t051-flow-f1-l15a-add-api-integration-spe
title: "FLOW-F1 L15a: add API integration specs TC-DELIVERY-FLOW-01, -02 and -09 against the real database"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
owner: OSS stream (Mateusz)
---

## Why

The F1 routes (intake, pin, stage artifacts/decisions, flow status, v1 gate) are proven only on the in-memory route kit.
The addendum's Integration Coverage rows FLOW-01, FLOW-02 and FLOW-09 require real-database evidence: encrypted intake
row, unique indexes on artifacts/decisions, row locks behind the lock header, and the gate on the frozen v1 routes.

## Scope

- `packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-FLOW-01-intake.spec.ts`
- `packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-FLOW-02-stage-approvals.spec.ts`
- `packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-FLOW-09-upstream-change.spec.ts`
- `packages/core/src/modules/delivery_os/__integration__/flowSpecKit.ts` (shared spec-local helper, not a spec)

## Out of scope

Any file outside `__integration__/`; QA's `TC-DELIVERY-UI-*`; FLOW-03/04 (comment import, L16+); fixing domain defects
(would be a separate task with a jest regression — report them instead).
