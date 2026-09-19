---
date: 2026-09-19T00:00:00+02:00
researcher: Claude (autonomous OSS developer)
git_commit: 2d184b1f1
branch: dev-mateusz
repository: open-mercato
topic: "OSS-04 L8a: what is already decided about claim, link_workflow, mark_delivery and closing the attempt on accept"
tags: [research, delivery_os, attempts, results, completion-delivery]
status: complete
last_updated: 2026-09-19
last_updated_by: Claude
---

# Research: OSS-04 L8a — internal attempt commands and closing the attempt on accept

## Research Question

What do the master plan, BREAKDOWN, the module spec and the existing code already decide about claim, link_workflow,
mark_delivery, closing the attempt on accept, `completionDelivery` pending → delivered, a delivery counter and the
trusted internal context?

## Summary

- The three command ids, their "enterprise (internal)" caller and "Internal commands have no HTTP route" are already
  frozen in `.ai/specs/2026-09-18-delivery-os-hackathon.md:251-256`. None of them is implemented; `commands/attempts.ts`
  registers only `delivery_os.attempts.reserve`.
- `lib/attempts.ts#claimAttempt` already exists and is tested (claims once, same worker idempotent, other worker
  `409 attempt_active`, gate `checkAttemptOpen`). Missing reducers: linkWorkflow, markDelivery, closeAttempt.
- `recordAttemptResult` sets `state: 'result_received'`, `resultEvidenceId`, `completionDelivery = 'pending'` only with a
  `workflowRef`. Nothing sets `closedAt` / `outcome: 'result_accepted'` today, although the enum value exists and
  `commands/tasks.ts:453` already reads it.
- `results.accept` already re-emits `delivery_os.evidence.recorded` with the current `completionDelivery` on a
  duplicate (in-transaction duplicate and unique-violation loser), and writes nothing.
- `deliveryOsAttemptQueries.listPendingDeliveries` filters `completionDelivery === 'pending' && workflowRef && resultEvidenceId`
  — a `delivered` attempt drops out without any change to the query.
- The trusted internal context is `!ctx.request` plus the typed option `trustedExecution: { source: 'delivery_agents', actorUserId }`
  (`data/validators.ts:234`, `commands/attempts.ts:61`); misuse answers `403 forbidden` / `trusted_execution_required`.
- No delivery retry counter exists in the DTO, spec, plan or BREAKDOWN. `registerWorkflowSafeCommands` lives in
  `packages/core/src/modules/workflows/lib/workflow-safe-commands.ts:53` (only customers, sales and catalog register
  entries); `UPDATE_ENTITY` runs such commands with a ctx without `request`, so these ids must never be registered there.
- `commands/__tests__/scopeChange.test.ts:261` pins the full `delivery_os.*` command id list and must gain the three ids.

## Detailed Findings

### Master plan / BREAKDOWN

- plan.md:326-330 — enqueue before marking dispatched; the worker calls the internal OSS command that writes evidence and
  `completionDelivery=pending` atomically, then the bridge signals the workflow step and marks delivered; "retry of
  delivery never re-runs the CLI"; pending is the durable truth, enterprise scans scoped pending rows and consumes
  `delivery_os.evidence.recorded`; an OSS-only attempt has no `workflowRef` and needs no signal.
- BREAKDOWN UA-23/24/25 (:108-110), BN-10 (:57), L8 (:158): trusted internal context through the command bus,
  `mark_delivery` records `delivered` or `lastDeliveryError` serialized under the task row lock, duplicates re-emit the
  pending signal, fake-executor test "executor invoked once".

### Code

- `lib/contracts.ts:620-650` `executionAttemptSchema` (non-strict `z.object`), states at :597, `ACTIVE_ATTEMPT_STATES` :607.
- `commands/shared.ts:185` `lockScopedTask` = scoped `PESSIMISTIC_WRITE` read; scope comes from `resolveDeliveryScope(ctx)`.
- Test harnesses: `commands/__tests__/attempts.test.ts` (store + `makeHarness({ inProcess })`), `results.test.ts`
  (published fixtures, `seedGit({ attempt })`), `attemptQueries.test.ts`.
- The attempt DTO is not copied outside `delivery_os` (no hit for `lastDeliveryError` in enterprise / delivery-cezar / hackathon).

## Open Questions (answered in the plan)

- Which `state` a result-closed attempt carries (`result_received` vs `closed`).
- How to store the delivery counter without breaking DTO v1 (additive optional field).
