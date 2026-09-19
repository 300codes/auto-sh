# FLOW-F1 L13b — Stage Artifact and Stage Decision Commands Implementation Plan

## Overview

Add the write path for versioned stage artifacts (F7 `delivery_os.stages.create_artifact`) and dependent stage
approvals (F8 `delivery_os.stages.decide`) declared in `.ai/specs/2026-09-18-delivery-os-hackathon.md` § Flow delta
v1. Both commands are thin shells around the pure rules of T042/T043: they resolve scope, load the pinned snapshot and
the append-only rows, run the plan, and persist one new row under the project lock. Routes (L14), comment threads (L17)
and the gate call sites in v1 commands (C21) are separate tasks; this task leaves a thread-loader seam and a deferral
hook that L17 plugs in.

## Current State Analysis

- `lib/stageArtifacts.ts#planStageArtifact({ artifact, project, template, existing, decisions, resolvedScopeAcIds?, acReferences? })`
  returns `duplicate` (identical content, before every other check), `foreign_reference`, `foreign_dependency`,
  `stage_not_approved`, `stage_dependency_stale`, `stage_artifact_stale`, `target_profile_frozen`, `unknown_ac`, or the
  next version + `downstreamNowStale`.
- `lib/stageDecisions.ts#planStageDecision({ request, idempotencyKey, stageId, template, grantedFeatures, artifacts,
  projectDecisions, threads, now })` returns `duplicate` (same key + same stage + same request hash), 403 `forbidden`
  (approver features), 409 `idempotency_conflict` / `subject_hash_mismatch` / `stage_artifact_stale`, 422
  `stage_not_approved` / `stage_dependency_stale` / `client_approval_required` / `blocking_comments_open` /
  `reason_required` / `foreign_reference`, or a `record` draft + `deferrals` + projected `currency`.
- Entities (T041): `DeliveryFlowStageArtifact` (unique per scope+project+stage+version and per
  scope+project+stage+contentHash, `templateHash`, `attachmentIds`, `createdBy`) and `DeliveryFlowStageDecision`
  (unique per scope+project+idempotencyKey; `clientApproverName` / `clientApprovalEvidence` in `encryption.ts`;
  `requestHash`, `templateHash`, `deferredThreadKeys`). Both append-only (`appendOnly.test.ts` scans command sources
  for property assignment on variables named `*ecision*`, `*aseline*`, `*vidence*`).
- Validators (T041): `stageArtifactCreateCommandSchema { projectId, stageId, artifact, trustedExecution? }` (path
  stage/project must equal the body → `foreign_reference` 422 at parse time; `foreign_dependency` is also a
  parse-time refinement of `stageArtifactV1Schema`), `stageDecisionCommandSchema { projectId, stageId,
  idempotencyKey, decision }`.
- Contracts: `stageArtifactCreateResponseSchema`, `stageDecisionResponseSchema` (with `currency`, `duplicate`,
  `projectUpdatedAt`), `deliveryFlowErrorCodes` (`stage_artifact_stale` 409, the rest 422), v1 `attempt_active` 409,
  `idempotency_key_required` 400.
- Existing patterns: `commands/flow.ts` (probe → replay → `requireLockHeader` → `em.transactional` +
  `lockScopedProject` + `enforceCommandOptimisticLockWithGuards` → write → emit → `buildLog`), `commands/intake.ts`
  (optional issued `trustedExecution`, attachment verification through `verifyAttachmentReferences` on the probe em),
  `commands/baselines.ts:233-238` (unique-violation recovery → re-read winner → `duplicate: true`),
  `commands/attempts.ts:70-78` (`idempotency_key_required` before parsing), `commands/projects.ts#checkProjectArchivable`
  (`reconciliation_required` / `attempt_active` over a task list), `lib/designReview.ts#collectAttachmentReferences`
  ({ screens, attachments } → references for the verifier).
- Approver features: `rbacService.getGrantedFeatures(userId, scope)` returns the grant list with wildcards intact
  (`packages/core/src/modules/auth/services/rbacService.ts:523`); `checkStageApprover` matches wildcards.
- Events `delivery_os.stage.artifact_created` and `delivery_os.stage.decided` are declared with payload paths
  (`events.ts:60-82`) and not emitted yet.
- Test kit (`commands/__tests__/baselineTestKit.ts`) has no store for stage rows and `em.create` always answers
  `NEW_ROW_ID`; `intake.test.ts` shows the local-store extension pattern (`rows(entity)` override + custom `persist`).
- `scopeChange.test.ts:255-281` pins the exact command id set (must gain the two new ids; `stages` is not an immutable
  subject and `create_artifact`/`decide` are not mutating actions, so no other expectation moves).

## Desired End State

`delivery_os.stages.create_artifact` and `delivery_os.stages.decide` registered through `commands/index.ts`, callable
from the command bus, honoring scope, replay-before-lock, the project optimistic lock, the pinned snapshot, the
attempt-active guard, attachment verification, approver features, client approval, hash binding and the frozen error
bodies; both events emitted after commit; `commands/__tests__/stages.test.ts` green; every other delivery_os suite green
(`appendOnly`, `scopeChange`, `attemptQueries`, …); core typecheck green; spec changelog + hand-over written.

### Key Discoveries:

- **`unknown_ac` is not reachable from F7 with the v1 content schemas**: neither `scopeContentSchema` nor
  `designStageContentSchema` carries AC references (design screens have no `acIds`; scope AC/requirement consistency
  is a parse-time `foreign_reference`). The command still passes `resolvedScopeAcIds` (from the bound current Scope
  artifact) and an `acReferences` collector that yields `[]` for v1 content, so an additive v2 content field plugs in
  without touching the plan. Recorded in the spec as a limitation; the test proves the actual reachable path.
- The template snapshot always contains exactly one stage per approval kind (`flowTemplateV1Schema` refinement), so
  `stage_unknown` can only fire on a corrupted snapshot; the command still checks it (fail closed).
- The lib plans treat replay as the first check, so probing on a forked em before the lock and re-planning under the
  row lock gives "replay before lock" and "authoritative under lock" with one code path (same trick as F3/F4).
- `clientApproved` of a stored decision derives from the encrypted `clientApproverName` being present; only an
  approval stores the approver columns, so the derivation is exact.
- `checkProjectArchivable` already computes exactly the F7 `attempt_active` / `reconciliation_required` refusal; only
  its messages speak of archiving. An additive `subject: 'stage'` keeps the code shared.

## What We're NOT Doing

- No HTTP routes, OpenAPI, mutation guards (L14); no gate call sites in `tasks.ts` / `attempts.ts` / `decisions.ts`
  (C21, next task); no comment-thread query or deferral persistence (L17 — the seam returns `[]` / no-op here).
- No entity, column, migration, contract, fixture or i18n change; no changes to frozen v1 commands beyond the additive
  `checkProjectArchivable` subject; no enterprise/UI files; no `TC-DELIVERY-*` integration specs (they ship with L14
  routes because the domain has no HTTP surface yet).
- No `10x-archive`, no git writes.

## Implementation Approach

One new file `commands/stages.ts` with both commands, mirroring `flow.ts`/`intake.ts`: parse → scope → probe on a
forked em (pinned snapshot, rows, replay) → lock header → transaction with `lockScopedProject` → authoritative plan →
attempt guard / optimistic lock → `tx.create` + `tx.persist` (never assign on a row after creation) → unique-violation
recovery → events → `buildLog` with ids only. Shared helpers for loading the snapshot, artifacts, decisions and mapping
rows to the lib record types live in the same file (they move to `shared.ts` when L14/F6 needs them).

## Phase 1: Commands

### Overview

Implement `commands/stages.ts`, register it, extend `checkProjectArchivable` with the stage subject, add the two ids to
`scopeChange.test.ts`.

### Changes Required:

#### 1. `commands/projects.ts` (additive)

- `checkProjectArchivable(tasks, subject: 'project' | 'task' | 'stage')`: `stage` messages "Cancel or reconcile the
  active attempt before a new stage version" / "Reconcile the unknown attempt before a new stage version".

#### 2. `commands/stages.ts` (new)

- Review fixes (F1–F3): stage rows have no `deletedAt` — filter by `{ projectId, tenantId, organizationId }` only and sort in code; resolve RBAC grants only when the stage lists `approverFeatures`; build history rows with one `tx.create` literal and never assign on a variable whose name contains `decision`/`baseline`/`evidence`.
- Helpers: `readPinnedSnapshot(project)` → `{ template, hash }` or throw 422 `flow_not_pinned`; `requireTemplateStage`
  → 422 `stage_unknown`; `loadStageArtifacts(em, projectId, scope)` (all stages, `findWithDecryption`), `loadStageDecisions`
  (all stages), row → `StageArtifactRecord` / `StoredStageDecisionRecord` mappers; `loadStageCommentThreads(em,
  projectId, stageId, scope)` returning `[]` (L17 seam, exported); `recordThreadDeferrals(tx, deferrals)` no-op (L17
  seam); `resolveGrantedFeatures(ctx, scope)` via `rbacService.getGrantedFeatures`, fail closed to `[]` with a warn +
  `reportError`; `collectArtifactAcReferences(artifact)` → `[]` for v1 content; `resolvedScopeAcIds(artifact,
  artifacts)` → AC ids of the bound current Scope artifact content, or `null`.
- `createArtifactCommand` (`delivery_os.stages.create_artifact`):
  1. optional `trustedExecution` accepted only in-process and issued (403 `trusted_execution_required` otherwise);
  2. scope, parse (`stageArtifactCreateCommandSchema`);
  3. probe em: project (404), snapshot (`flow_not_pinned`), template stage (`stage_unknown`), rows → `planStageArtifact`;
     duplicate → answer `{ duplicate: true }` with the existing ref (no lock, no write, no event); other failure → throw;
  4. attachments: `verifyAttachmentReferences(probeEm, ctx, collectAttachmentReferences({ screens: content.screens ?? [],
     attachments }), scope)` → `assertDeliveryCheck`;
  5. `requireLockHeader(ctx)` when `ctx.request` is set;
  6. tx: `lockScopedProject`, re-read snapshot + rows, re-plan (duplicate → return), attempt guard
     (`checkProjectArchivable(tasks, 'stage')` over the project's tasks), `enforceCommandOptimisticLockWithGuards`,
     `tx.create(DeliveryFlowStageArtifact, …)` with `version`, `contentHash`, `templateHash`, `attachmentIds`,
     `createdBy`, `project.updatedAt = now`;
  7. `isUniqueViolation` → re-read by (project, stage, hash) → duplicate;
  8. emit `delivery_os.stage.artifact_created` (ids, version, hash, `downstreamNowStale`, scope) when not duplicate;
  9. result `StageArtifactCreateResponse & { duplicate }` parsed through `stageArtifactCreateResponseSchema`.
- `decideCommand` (`delivery_os.stages.decide`):
  1. `requireIdempotencyKey(rawInput)` (400 `idempotency_key_required`) before parsing;
  2. scope, parse (`stageDecisionCommandSchema`), actor (`requireActorUserId`);
  3. probe em: project, snapshot, granted features, rows, threads → `planStageDecision` (403 / replay / 409 / 422);
     duplicate → response from the stored row with the current currency (no lock);
  4. `requireLockHeader(ctx)`;
  5. tx: lock project, reload rows, re-plan, `enforceCommandOptimisticLockWithGuards`, `tx.create(DeliveryFlowStageDecision,
     …)` with `decidedAt = now`, `templateHash`, `idempotencyKey`, `requestHash`, approver name/role/evidence copied
     from the parsed request only when `record.clientApproved`, `deferredThreadKeys = record.deferredThreadKeys`;
     `recordThreadDeferrals(tx, plan.deferrals)`; `project.updatedAt = now`;
  6. `isUniqueViolation` → re-read by (project, key): same stage + hash → duplicate, else 409 `idempotency_conflict`;
  7. emit `delivery_os.stage.decided` (ids, verdict, currency, scope) when not duplicate;
  8. result parsed through `stageDecisionResponseSchema`.
- `buildLog` for both: null on duplicate; ids, stage, version/verdict only (approver name is PII).

#### 3. Registration

- `commands/index.ts`: `import './stages'`.
- `commands/__tests__/scopeChange.test.ts`: add `delivery_os.stages.create_artifact`, `delivery_os.stages.decide`.

### Success Criteria:

#### Automated Verification:

- [ ] `yarn workspace @open-mercato/core jest src/modules/delivery_os/commands --maxWorkers=2` green (existing suites)
- [ ] `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` green

## Phase 2: Tests

### Overview

`commands/__tests__/stages.test.ts` with a local store extension (stage artifacts, stage decisions, tasks, attachments),
unique ids from `em.create`, a fake `rbacService.getGrantedFeatures` (default `['delivery_os.stages.approve']`, configurable per test), and a helper that walks the four stages.

### Changes Required:

#### 1. `commands/__tests__/stages.test.ts` (new)

Cases (F7): four stages in order (versions, `downstreamNowStale: []`, events, ux with a verified attachment);
`foreign_dependency` (parse-time); `stage_artifact_stale` 409 (ux bound to Scope v1 after Scope v2); `stage_not_approved`
(ux before Scope approval); `stage_dependency_stale` (KV when ux is stale); `target_profile_frozen` (Scope with another
platform); `unknown_ac` reachability (documented: AC → unknown requirement is a parse-time `foreign_reference`, and the
command passes the resolved Scope AC set); duplicate content → `duplicate: true`, no row, no event, no lock header;
`attempt_active` 409 with an active attempt on a project task; `flow_not_pinned`; path/body stage mismatch; 428
`optimistic_lock_required`; stale header 409; unique-violation recovery; foreign org 404; attachment scope mismatch.
Cases (F8): approve → reject → approve = three rows; same key + body → duplicate (no row, no event, no lock); same key +
other body → 409 `idempotency_conflict`; old hash → 409 `subject_hash_mismatch`; `client_approval_required` on
`key_visual`; approver features unmet → 403 with the `stages.key_visual.approverFeatures` detail; wildcard grant passes;
`idempotency_key_required`; new Scope version → downstream `stale`, history retained, ux approval refused with
`stage_dependency_stale`; unique-violation replay; `reason_required` (parse-time); encrypted approver columns stored.

### Success Criteria:

#### Automated Verification:

- [ ] `yarn workspace @open-mercato/core jest src/modules/delivery_os/commands/__tests__/stages.test.ts --maxWorkers=2` green
- [ ] `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` green (incl. `appendOnly`, `scopeChange`)

## Phase 3: Spec, hand-over, gate

### Changes Required:

- `.ai/specs/2026-09-18-delivery-os-hackathon.md`: changelog entry (T045) + the `unknown_ac` reachability note on F7
  and the L17 seam note on F8.
- `context/changes/delivery-os-oss-domain/handover/FLOW-F1-L13b-stages.md`: contract facts for Adam (UI) and Marcin
  (workflow/agent), evidence, limitations.
- Typecheck, lint on touched files.

### Success Criteria:

#### Automated Verification:

- [ ] `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` green
- [ ] `yarn eslint` on the touched files clean

## Testing Strategy

### Unit Tests:

In-memory kit, one suite; lib rules already have their own suites (T042/T043) so command tests focus on ordering,
locks, replay, persistence shape, events and the seams.

### Integration Tests:

None here (no HTTP surface until L14); `TC-DELIVERY-FLOW-02/09` ship with the routes.

### Manual Testing Steps:

None possible without routes; the dev server on :3100 is untouched.

## Performance Considerations

Rows are loaded per project (all stages) once per probe and once under lock; bounded by the append-only history of one
project. No unbounded arrays leave the command.

## Migration Notes

None.

## References

- Spec rows F7/F8, D5–D7: `.ai/specs/2026-09-18-delivery-os-hackathon.md`
- Rules: `packages/core/src/modules/delivery_os/lib/{stageArtifacts,stageDecisions,flowRules}.ts`
- Patterns: `packages/core/src/modules/delivery_os/commands/{flow,intake,baselines,attempts,projects}.ts`
- Previous task: `context/changes/asd-oss-t044-flow-f1-l13a-add-intake-and-flow-pin/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Commands

#### Automated

- [x] 1.1 Extend checkProjectArchivable with the stage subject
- [x] 1.2 Implement commands/stages.ts (create_artifact, decide, seams)
- [x] 1.3 Register in commands/index.ts and scopeChange expectations

### Phase 2: Tests

#### Automated

- [x] 2.1 Write commands/__tests__/stages.test.ts
- [x] 2.2 Run the delivery_os jest suites

### Phase 3: Spec, hand-over, gate

#### Automated

- [x] 3.1 Spec changelog and notes
- [x] 3.2 Hand-over note
- [x] 3.3 Typecheck and lint
