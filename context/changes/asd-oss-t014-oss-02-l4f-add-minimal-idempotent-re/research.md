---
topic: "Result acceptance (results.accept) — what exists and what constrains it"
researcher: autonomous developer (main context only; hard RAM rule, same choice as T012/T013)
date: 2026-09-19
---

# Research: minimal idempotent result acceptance

## Question

What already exists for UA-12 / UA-24 in `delivery_os`, and which facts constrain `evaluateResultAcceptance` and
`delivery_os.results.accept`?

## Code References

- `lib/resultAcceptance.ts:27` — `checkResultCorrelation(taskPackage, manifest)` exists (`correlation_mismatch`,
  `baseline_mismatch`, `base_revision_mismatch`). Nothing else is in the file.
- `lib/contracts.ts:418` — `resultManifestV1Schema` is a plain `z.object` (not strict): unknown keys such as
  `tenantId` are stripped on parse. `parseVersioned` (`:743`) answers `unsupported_schema_version` 422.
- `lib/contracts.ts:40` — the frozen catalogue code for "different manifest on an attempt with a result" is
  `result_conflict` (409). `attempt_cancelled`, `attempt_closed`, `reconciliation_required` are 409.
- `lib/contracts.ts:608` — `executionAttemptSchema` is frozen and has NO result-hash field; it has
  `resultEvidenceId`, `completionDelivery`, `workflowRef`, `externalRunId`. The result hash therefore lives on
  `DeliveryEvidence.payloadHash`.
- `lib/attempts.ts:113` — `checkAttemptOpen` is the export/claim gate (rejects `cancel_requested`,
  `reconciliation_required`, `result_received`, `closed`). Results need their own gate (T008 decision): a
  `completed` reconciliation keeps the attempt state (`lib/attempts.ts:256-258`) and must still let a manifest in.
- `lib/taskPackage.ts:93` — `buildTaskPackageV1` refuses non-open attempts, so it cannot be used as-is for a
  replay on a closed attempt or for a `completed` reconciliation. It needs an opt-out of the open gate.
- `lib/taskLifecycle.ts:19-22,66` — `executing → awaiting_review` and `blocked → awaiting_review` are in the
  table; `awaiting_review` is not a reconciliation-locked target.
- `data/entities.ts:202-271` — `DeliveryEvidence` has no `updatedAt`/`deletedAt`; partial unique index
  `delivery_evidence_result_manifest_uq (tenant, org, task, attempt) where kind='result_manifest'`.
- `commands/baselines.ts:157-200` — the pattern for recovering a unique violation as `duplicate`
  (`isUniqueViolation`, captured hash, re-read with a fresh EM).
- `commands/attempts.ts` — the pattern for a task command: `lockScopedTask`, unreadable register →
  `reconciliation_required/unreadable_attempt_register`, trusted-execution 403, emit after commit,
  `buildLog` returns `null` on replay.
- `commands/tasks.ts:409,423` — `emitTaskSideEffects`, `emitTaskUpdated`; `:188` `findProjectBaseline`.
- `events.ts` — `delivery_os.evidence.recorded` payload `{projectId, taskId?, attemptId?, evidenceId, kind,
  duplicate, completionDelivery?, tenantId, organizationId}`.
- Fixtures: `result-manifest.v1.json` correlates with `task-package.v1.json` (react-vite, git);
  `*.snapshot.v1.json` pair is wordpress-theme; negatives `foreign-attempt`, `foreign-task`
  (`correlation_mismatch`), `snapshot-for-react` (`revision_kind_mismatch`), `missing-check-fields`,
  `status-skipped` (schema).
- Spec `.ai/specs/2026-09-18-delivery-os-hackathon.md:281,306` — R16 takes no lock header ("idempotent by
  attempt + manifest hash"); order: scope → schema → idempotency → correlation → allowedPaths → hashes.

## Architecture Insights

- The revision-kind check must run before field correlation, or the `snapshot-for-react` fixture would answer
  `base_revision_mismatch` instead of the published `revision_kind_mismatch`.
- Locking only the task row is deadlock-free: every other writer takes project → tasks, this command holds one lock.
