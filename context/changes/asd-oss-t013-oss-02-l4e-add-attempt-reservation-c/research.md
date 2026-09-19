---
date: 2026-09-19T04:20:00+02:00
researcher: Claude (autonomous OSS developer)
git_commit: 2a5b4178f
branch: dev-mateusz
repository: open-mercato
topic: "How do the delivery_os lib and commands work, so that buildTaskPackageV1 and delivery_os.attempts.reserve fit in?"
tags: [research, codebase, delivery_os, attempts, task-package]
status: complete
last_updated: 2026-09-19
last_updated_by: Claude
---

# Research: attempt reservation command and TaskPackage builder

Done by reading the code in the main context (no sub-agents: hard RAM rule on this machine, same choice as T012).
Paths are relative to `packages/core/src/modules/delivery_os/`.

## Research Question

How do the existing lib (`attempts.ts`, `contracts.ts`, `targetProfiles.ts`, `taskLifecycle.ts`, `baseline.ts`,
fixtures) and commands (`shared.ts`, `tasks.ts`, `decisions.ts`, test kits) work, so that a pure
`buildTaskPackageV1` and the `delivery_os.attempts.reserve` command can be added consistently?

## Summary

Everything the task needs already exists as pure reducers and shared command helpers; T013 is wiring.

- `lib/attempts.ts:133` `reserveAttempt(register, input)` already orders replay → `idempotency_conflict` →
  `reconciliation_required` → `attempt_active` → `attempt_limit_reached` → schema validation, and returns
  `outcome: 'created' | 'existing' | 'conflict'`. It hashes `input.payload` canonically. `baselineHash` is unused
  on the `existing` path.
- `lib/attempts.ts:113` `checkAttemptOpen` gives `attempt_not_found` / `reconciliation_required` /
  `attempt_cancelled` / `attempt_closed`; only `reserved` and `claimed` are open.
- `lib/contracts.ts:331` `taskPackageV1Schema` requires ≥1 AC, `requiredTests` keys ⊆ package ACs, every AC's
  requirement present, and `baseCommit` present exactly for a git revision. `buildPackageUrl` (`:671`) and
  `reserveAttemptResponseSchema` (`:681`) define the reserve response; `reserveAttemptRequestSchema` (`:675`) is the
  public body (literal `manual_handoff`).
- `lib/targetProfiles.ts:156` `assertRevisionKind(profile, revision)` → 422 `revision_kind_mismatch`;
  `react-vite` is git, `wordpress-theme` is snapshot. `profile.checks` is the `validationProfile.checks` list.
- `lib/taskLifecycle.ts:135` `canTransition(from, 'executing', { source: 'command', statusReason, correction })`
  allows `ready → executing` and `changes_requested → executing`, needs a `CorrectionBudget`, and refuses with
  `correction_limit_reached` when `requested > max`.
- `commands/shared.ts`: `resolveDeliveryScope`, `resolveDeliveryEm`, `lockScopedTask` (PESSIMISTIC_WRITE on the task
  row, 404 `not_found`), `requireScopedProject` (archived → 404), `requireLockHeader` (428 / 400),
  `enforceCommandOptimisticLockWithGuards` with `envValue: 'all'` to force the compare (pattern of
  `lockProjectForWrite(..., { force: true })`), `assertDeliveryCheck`, `deliveryHttpError`, `parseDeliveryInput`.
- `commands/tasks.ts` holds private helpers that reserve needs: `findProjectBaseline` (`:188`),
  `loadCorrectionBudget` (`:368`), `emitTaskSideEffects` (`:409`), `emitTaskUpdated` (`:423`). They must be exported.
- `commands/projects.ts:139`: an unreadable register is reported fail-closed as `reconciliation_required` with
  detail `unreadable_attempt_register`.
- `commands/baselines.ts:214`: `buildLog` returns `null` for a duplicate, so a replay writes no audit entry.
- Fixtures: `lib/fixtures/baseline-content.v1.json` has AC-001..AC-003, REQ-1..2, tests for AC-001/AC-002 and one
  screen; `task-package.v1.json` is the react-vite package of a task with AC-001 + AC-002 (AC-003 excluded), so the
  builder can be compared against it with `toEqual`. `task-package.snapshot.v1.json` is the wordpress-theme variant.
- Tests: `commands/__tests__/tasks.test.ts` has the in-memory store + mocked `findWithDecryption` pattern for tasks;
  `baselineTestKit.ts` has the shared `makeHarness`, `catchHttpError`, `expectFrozenBody`, `detailCodes`, but its
  store has no tasks/evidence, so the attempts test needs its own small store like `tasks.test.ts`.
- `DeliveryTask.attemptNumber` exists (`data/entities.ts:184`) and nothing writes it yet.

## Spec anchors

- `.ai/specs/2026-09-18-delivery-os-hackathon.md:250` — `automatic` only in-process, no `ctx.request`, typed
  `trustedExecution { source: 'delivery_agents', actorUserId }`.
- same file `:304` (UA-10) — 201 new / 200 replay "checked before the lock"; 409 `idempotency_conflict`,
  `attempt_active`, `attempt_limit_reached`, `dependency_not_verified`, `task_not_ready`, `reconciliation_required`,
  `optimistic_lock_conflict`; 422 `revision_kind_mismatch`; 428; 400 `idempotency_key_required`.
- same file `:305` (UA-11) — GET builds the package, no writes; 404 `attempt_not_found`; 409 cancelled/closed.
- Master plan `plan.md:107,127,147` — one active attempt, 16-attempt limit, reservation before spawn.

## Open Questions

None blocking. `task_blocked` from BREAKDOWN UA-10 is not a catalogue code → it becomes a detail code of
`task_not_ready` (decision recorded in the plan).
