# FLOW-F1 L12a — Pure Intake and Stage-Artifact Rules Implementation Plan

## Overview

Add the pure decision logic behind F2 (`PUT /projects/:id/intake`), F3 (`POST /projects/:id/intake/proposals`) and
F7 (`POST /projects/:id/stages/:stageId/artifacts`) of the Flow delta v1 (`.ai/specs/2026-09-18-delivery-os-hackathon.md`
§ Flow delta v1). No ORM, no routes, no commands: the L13 commands load rows, call these functions under the project
lock and persist the outcome.

## Current State Analysis

- F0 schemas live in `lib/contracts.ts` (block "Flow delta v1"): `intakeV1Schema`, `intakeUpdateRequestSchema`
  (strips `projectId` and `proposals`), `scopingProposalV1Schema`, `stageArtifactV1Schema`, `DeliveryFlowCheckResult`,
  `buildDeliveryFlowError`, `FLOW_APPROVAL_STAGE_ORDER`, `importedManifestSchema`.
- `lib/flowRules.ts` already has `computeStageCurrency`, `checkFlowGate`, `checkPlatformChoiceFrozen`,
  `StageArtifactRecord`, `StageDecisionRecord`.
- `lib/hash.ts#hashCanonical` gives the canonical sha256.
- Entities from T041: `DeliveryIntake` (with `importedManifests` jsonb), `DeliveryFlowStageArtifact` (unique per
  `(project, stage, version)` and `(project, stage, content_hash)`).
- `contracts.test.ts` pins the 54 v1 codes; every code used here already exists in `deliveryAllErrorCodes`.

## Desired End State

`lib/intakeRules.ts` and `lib/stageArtifacts.ts` export pure functions returning `DeliveryFlowCheckResult`-style
outcomes with the published codes; `lib/__tests__/intakeRules.test.ts` and `lib/__tests__/stageArtifacts.test.ts`
cover each code positively and negatively using the F0 fixtures.

### Key Discoveries:

- Intake step enum is `brief | scoping | platform | review | submitted` (`lib/contracts.ts:1172`).
- The scoping fixture re-asks `Q-001` unanswered while the intake fixture has it answered — merge must not clobber.
- Currency semantics (`flowRules.ts#computeStageCurrency`): `approved` only when the upstream chain is approved and
  bound to the current hash, else `stale`; the artifact rules reuse the same map instead of re-deriving.
- Under jest, avoid `structuredClone` before `hashCanonical` (host-realm objects); use JSON round-trip.

## What We're NOT Doing

- No commands, routes, events, ACL, DI, migrations or entity changes (L13).
- No attachment verification (`attachment_*`; commands/attachments.ts in L13), no `attempt_active`, no
  `flow_not_pinned`/`stage_unknown` (route/command concerns).
- No change to any F0 schema, fixture or the 54-code pin.
- Stage decisions and flow status rules (L12b/c).

## Implementation Approach

Decisions made autonomously (recorded in the final report):

1. **Step transitions**: staying, moving back to any earlier step, or forward by exactly one step is allowed;
   skipping forward is `intake_step_invalid`. `submitted → review` (reopen) is allowed as a backward move.
2. **Submit precondition**: `submitted` needs `platform.chosen` and no blocking question without an answer
   (`intake_step_invalid`, one detail per offending question); checked on entering and on staying in `submitted`.
3. **Frozen profile**: `platform.chosen` is always checked with `checkPlatformChoiceFrozen` (`target_profile_frozen`),
   also on proposal import (the recommendation may differ, it is stored).
4. **Update**: `applyIntakeUpdate(stored | null, request, projectId)` returns the full `IntakeV1` with `projectId` and
   `proposals` taken from the stored row (never from the body), then re-checks stable ids.
5. **Proposal merge**: `manifestHash = hashCanonical(parsed proposal)`. Replay by `importedManifests`: same id + hash →
   `duplicate` (no change); same id + other hash → `idempotency_conflict`; `projectId` ≠ intake → `foreign_reference`
   (checked first). Questions merge by id — an existing question wins (keeps the human answer), new ids are appended.
   A proposal ref `{ proposalId: manifestId, kind, contentHash: manifestHash, proposedAt: now, status: 'proposed' }`
   is appended; `proposal.platform` (when non-null) replaces `platform.recommendation`. The result is re-validated
   with `intakeV1Schema` (capacity overflow → `validation_failed`).
6. **Artifact content hash** = `hashCanonical({ schemaVersion, stageId, content, dependsOn, attachments })`:
   `projectId`, `source`, `producedBy` are provenance, not content, so the same content from another source is a
   duplicate; a new `dependsOn` binding is new content (re-approval after an upstream change needs a new version).
7. **Artifact check order**: duplicate (replay wins) → `foreign_dependency` (not strictly upstream) →
   `foreign_reference` (bound artifact not among the project's artifacts or stage/version mismatch) → upstream
   approval for every template-required and every bound upstream (`stage_not_approved` / `stage_dependency_stale` from
   the currency map) → missing required binding or binding ≠ upstream current artifact (`stage_artifact_stale`, 409) →
   scope platform vs frozen profile (`target_profile_frozen`, path `content.platform`) → `unknown_ac`.
8. **unknown_ac**: optional caller-supplied `acReferences: { path, acId }[]` checked against the AC set of the scope
   the artifact resolves to (own content for `scope`, otherwise the caller-supplied bound scope content). Default none.
10. **Duplicate outcome** carries `existing` and `isCurrent` (an identical older version is not the current one; the
   L13 command decides). **No stored intake** behaves as `defaultIntake(projectId)` (step `brief`). Inside one check
   category every offending entry yields one detail; the first failing category stops the evaluation.
9. **downstreamNowStale**: every stage strictly after this one that has a current artifact (its binding chain now
   points at a superseded version); `[]` on duplicate.

## Phase 1: Intake rules

### Changes Required:

#### 1. `packages/core/src/modules/delivery_os/lib/intakeRules.ts` (new)

**Intent**: pure rules for F1/F2/F3.

**Contract**: exports `INTAKE_STEP_ORDER`, `defaultIntake(projectId)`, `checkIntakeStepTransition(from, to)`,
`checkIntakeSubmittable(intake)`, `checkIntakeStableIds(intake)`, `applyIntakeUpdate({ stored, request, project })`
→ `{ ok: true, intake } | failure`, `hashScopingProposal(proposal)`, `mergeScopingProposal({ stored, importedManifests,
proposal, project, now })` → `{ ok: true, duplicate, manifestHash, intake, importedManifests } | failure`.

#### 2. `lib/__tests__/intakeRules.test.ts` (new)

Fixture-driven: positive fixture round-trip, every code negative, proposals stripped, answer preserved, replay.

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib/__tests__/intakeRules.test.ts --maxWorkers=2` green

## Phase 2: Stage-artifact rules

### Changes Required:

#### 1. `packages/core/src/modules/delivery_os/lib/stageArtifacts.ts` (new)

**Contract**: exports `hashStageArtifactContent(artifact)`, `nextStageArtifactVersion(existing, stageId)`,
`findDuplicateStageArtifact(existing, stageId, contentHash)`, `downstreamStagesWithArtifacts(existing, stageId)`,
`checkAcReferences(knownAcIds, refs)`, `planStageArtifact({ artifact, project, template, existing, decisions,
boundScope?, acReferences? })` → `{ ok: true, duplicate: true, existing } | { ok: true, duplicate: false, version,
contentHash, downstreamNowStale } | failure`.

#### 2. `lib/__tests__/stageArtifacts.test.ts` (new)

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib/__tests__/stageArtifacts.test.ts --maxWorkers=2` green
- flowContracts / flowFixtures / contracts suites still green
- scoped typecheck of the new files and eslint on `delivery_os/lib` clean

## Testing Strategy

Unit only (pure functions). FLOW-01/02/09 integration specs ship with the L13 commands.

## References

- Spec rows F1–F3, F7: `.ai/specs/2026-09-18-delivery-os-hackathon.md`
- `lib/flowRules.ts`, `lib/proposals.ts` (replay/unknown_ac style)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Intake rules

#### Automated

- [x] 1.1 intakeRules jest suite green

### Phase 2: Stage-artifact rules

#### Automated

- [x] 2.1 stageArtifacts jest suite green
- [x] 2.2 flowContracts / flowFixtures / contracts suites still green
- [x] 2.3 scoped typecheck and eslint clean
