# FLOW-F4 L20b `delivery_os.publications.record` Implementation Plan

## Overview

Register the F14 command that records a WordPress/static/preview publication for a delivery project: it validates the
`PublicationResult v1`, correlates it with an approved deploy decision for the same baseline + revision, runs the pinned
flow gate, and writes the v1 `deployment` evidence row and the `delivery_publications` row in one transaction, so the
existing R21 release decision and R22 report keep working unchanged (BN-28, UA-43, UA-48 publication path).

## Current State Analysis

- T059 (L20a) delivered the entity `DeliveryPublication` (`data/entities.ts:582`, UQ `(tenant, org, project, payload_hash)`),
  the F4 migration, `recordPublicationCommandInputSchema` (`data/validators.ts:585`, `foreign_reference` on
  `publication.projectId ≠ projectId`) and pure rules in `lib/publicationRules.ts` (`checkPublicationDeployConsent`,
  `buildDeploymentEvidencePayload`, `hashPublicationPayload`).
- `commands/evidence.ts:502` `recordEvidenceInTransaction(tx, ctx, projectId, input, scope)` locks the project and then
  records; the deployment branch derives `verificationStatus` via `deriveDeploymentVerificationStatus`.
- `commands/decisions.ts:256` `checkDeployConsent(allDeployDecisions, baselineHash, revision)`; R21 release requires an
  evidence row of kind `deployment` with `isVerifiedDeploymentPayload`.
- `commands/flowGate.ts` exports `loadFlowGateStates` (null legacy / 'unreadable' / states) and `readPinnedTemplate`;
  `lib/flowRules.ts:169` `checkFlowGate(states, stages, { v1Compatible })`.
- `commands/stages.ts:214` shows the wildcard-aware grant lookup (`rbacService.getGrantedFeatures`, fail closed) and the
  probe → replay → `requireLockHeader` → tx(lock, re-plan, `enforceCommandOptimisticLockWithGuards`) → unique-violation
  recovery ordering to mirror.
- `commands/index.ts` registers commands by import; `scopeChange.test.ts:260` lists the exact command ids.
- No command exists yet; `commands/__tests__/publicationFlow.test.ts` is the v1 route flow (unrelated name).

## Desired End State

`delivery_os.publications.record` is registered and behaves per the F14 table; `yarn workspace @open-mercato/core jest
src/modules/delivery_os --maxWorkers=2` and the scoped typecheck are green; `commands/index.ts` diff is one appended
line; `scopeChange.test.ts` id list has one added entry; no imports from enterprise/staff/workflows.

### Key Discoveries

- The baselineTestKit `persist` mock routes rows by shape (`proposalTaskKey`/`contentHash`/else decisions): the new test
  overrides `em.persist` and the entity→rows mapping for `DeliveryPublication`, `DeliveryEvidence`, stage rows.
- `TARGET_PROFILES[0]` (`react-vite`, git) permits `deployment`; the fixture publication uses a snapshot revision, so the
  test builds its own payload with a git revision on the kit project (or a `wordpress-theme` project with snapshot).
- `checkPublicationDeployConsent` details use path `deployDecisionId`; `checkDeployConsent` uses `deploymentEvidenceId` —
  both are kept (recorded decision T059/L20b order).

## What We're NOT Doing

- Route F14 (`api/projects/[id]/publications/route.ts`), the GET list, OpenAPI, the fake deploy adapter and the
  Playwright FLOW-07 spec (L20c/L20d, next tasks).
- New event, ACL feature, DI key, migration or encryption entry (recorded decision).
- Any change to `delivery_os.evidence.record` behaviour, the v1 error bodies or lane A's F2 seam.

## Implementation Approach

Mirror F8 (`stages.decide`) ordering with the evidence helper extracted additively:

parse → scope/project 404 → replay by payload hash (no lock) → feature grant check (403, fail closed) → actor →
`requireLockHeader` (HTTP) → tx: `lockScopedProject` → `enforceCommandOptimisticLockWithGuards` → baseline of project →
named deploy decision (`findOneWithDecryption`, project-scoped) → `checkPublicationDeployConsent` → `checkDeployConsent`
over all deploy decisions → `verification.evidenceId` must be an evidence row of the project → flow gate
(`loadFlowGateStates`; unreadable → fail closed; `checkFlowGate(..., { v1Compatible: false })` → `stage_not_approved`) →
`recordEvidenceWithinTransaction` kind `deployment` → persist `DeliveryPublication` → bump `project.updatedAt` →
outside: unique violation → re-read → duplicate; audit log via `buildLog`.

## Decisions (answered autonomously)

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| D1 | Feature check location | In the command, BEFORE the replay probe: `rbacService.getGrantedFeatures` + `hasAllFeatures(['delivery_os.results.import'])`, fail closed 403; requires a signed-in actor | Task text; in-process adapters cannot bypass the gate (safety criterion) |
| D2 | Project version bump | `project.updatedAt = now` on a new publication | Consistent with stages/decisions; a publication changes the project's version for concurrent editors |
| D3 | Evidence helper shape | `recordEvidenceWithinTransaction(tx, ctx, project, input, scope)` = existing body minus the lock; old function calls it | Byte-identical public command, one transaction |
| D4 | Evidence input | Build the v1 `deployment` body and run it through `parseRecordEvidenceBody` (deployment_incomplete surfaces as 422) | Reuses the frozen validator; no second schema |
| D5 | Named decision check before all-decision check | `checkPublicationDeployConsent` then `checkDeployConsent` | Recorded L20a hand-over order; newer reject on same revision wins |
| D6 | Snapshot attachment | `attachmentIds: [snapshotRef.attachmentId]` verified by `verifyEvidenceAttachments` (foreign → `foreign_reference`) | Spec: attachments scoped; no hash re-check needed for a ref already hashed by the payload |
| D7 | Rollback test | `transactional` mock snapshots the store and restores on throw | Proves both rows live in one callback without a DB |

## Phase 1: Evidence helper + publication command

### Changes Required

#### 1. `commands/evidence.ts`
**Intent**: export an in-transaction variant that does not open a lock, keeping `recordEvidenceInTransaction` as
`lockScopedProject` + the new helper.
**Contract**: `export async function recordEvidenceWithinTransaction(tx, ctx, project: DeliveryProject, input: RecordEvidenceInput, scope): Promise<{ evidenceId: string; evidence: DeliveryEvidence | null }>` (returns the existing `RecordOutcome`, exported as a type).

#### 2. `commands/flowGate.ts`
**Intent**: export `unreadableSnapshotDetails()` so the publication gate can fail closed with the same details.

#### 3. `commands/publications.ts` (new)
**Intent**: the command described above. Result `{ publicationId, deploymentEvidenceId, duplicate }`
(`publicationRecordResponseSchema`), audit `delivery_os.audit.publications.record` (fallback text; i18n key is a UI patch
request), resource kind `delivery_os.publication`.

#### 4. `commands/index.ts`
**Intent**: append `import './publications'`.

#### 5. `commands/__tests__/scopeChange.test.ts`
**Intent**: add `'delivery_os.publications.record'` to the sorted id list; `publications` is append-only → add to
`IMMUTABLE_SUBJECTS` and the appendOnly expectation (no routes yet, so the route list stays).

### Success Criteria

#### Automated Verification
- `yarn workspace @open-mercato/core jest src/modules/delivery_os/commands/__tests__/publications.test.ts --maxWorkers=2` green
- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` green (old suites unchanged)
- `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` green
- `git diff --stat packages/core/src/modules/delivery_os/commands/index.ts` shows one added line; no enterprise/staff/workflows imports

## Phase 2: Tests `commands/__tests__/publications.test.ts`

Cases: 201 happy path (one evidence + one publication, persisted in one transactional callback, R21 release succeeds on
the returned evidence id); replay → duplicate without lock header; stale lock → 409; missing feature → 403; missing /
rejected / other-baseline decision → `deploy_decision_missing`; decision on revision A, publication on B →
`revision_mismatch`; newer reject on the same revision → `deploy_decision_missing` (`deploy_decision_rejected`);
foreign `verification.evidenceId` / foreign `baselineId` / body `projectId` mismatch → `foreign_reference`; pinned
project with UX pending → `stage_not_approved` with per-stage details; unreadable snapshot → fails closed; legacy
project → no stage query; unverified publication → evidence row R21 refuses with `deployment_unverified`; unique
violation → duplicate; throw while persisting the publication → evidence rolled back.

### Success Criteria

#### Automated Verification
- Test file green with `--maxWorkers=2`
- `FLOW-progress.md` appended (3-6 lines)

## References

- Spec F14: `.ai/specs/2026-09-18-delivery-os-hackathon.md:504`
- Rules: `packages/core/src/modules/delivery_os/lib/publicationRules.ts`
- Pattern: `packages/core/src/modules/delivery_os/commands/stages.ts` (decide), `commands/evidence.ts:502`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Evidence helper + publication command

#### Automated

- [x] 1.1 publications.test.ts green
- [x] 1.2 delivery_os module suite green
- [x] 1.3 scoped typecheck green
- [x] 1.4 commands/index.ts one appended line; no enterprise/staff/workflows imports

### Phase 2: Tests

#### Automated

- [x] 2.1 all listed cases covered and green
- [x] 2.2 FLOW-progress.md appended
