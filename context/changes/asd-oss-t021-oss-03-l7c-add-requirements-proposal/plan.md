# OSS-03 (L7c): requirements-proposal import on the baselines route — Implementation Plan

## Overview

Add the command `delivery_os.baselines.import_requirements` and dispatch to it from R7
(`POST /api/delivery_os/projects/:id/baselines`, `source: 'requirements_proposal'`). An agent's
`RequirementsProposal v1` is validated, merged into the project draft and frozen as the next append-only baseline
version through the same builder as the manual path, idempotently by `manifestId` + manifest hash.

## Current State Analysis

- `commands/baselines.ts` has only `delivery_os.baselines.create`; a `requirements_proposal` source answers
  `400 validation_failed`/`unsupported_source`. The route already gates that source behind `delivery_os.results.import`.
- `lib/proposals.ts` `validateRequirementsProposal` (pure) and `lib/baseline.ts` `buildBaselineContent(draft, extras)` exist.
- Nothing stores a `manifestId`, so the spec's `409 idempotency_conflict` (same `manifestId`, different hash) cannot be
  answered. `BaselineContent v1` only has `importedManifestHashes[]`.
- The route reads the body with the uncapped `readRouteBody`; `readCappedRouteBody` exists.
- No migration needed: `source` allows `requirements_proposal`; unique `(project_id, content_hash)` exists.

## Desired End State

`POST …/baselines { source: 'requirements_proposal', manifest }` with `delivery_os.results.import` and a current project
lock header answers `201 { baselineId, version, contentHash, duplicate: false, openCommentIds, projectUpdatedAt }`,
writes baseline version n+1 (`source: 'requirements_proposal'`) and copies the merged draft into the project in the
same transaction. The same manifest again answers `200 duplicate: true` with the first baseline and writes nothing,
even with a stale or missing lock header. Same `manifestId` with other content → `409 idempotency_conflict`. Unknown
schema version → `422 unsupported_schema_version`; foreign `projectId` → `422 foreign_reference`; stale header on a new
manifest → platform `409`; manage-only user → `403`; foreign project → `404`. `activeBaselineId` and existing baselines
are never touched.

### Key Discoveries:

- `commands/baselines.ts:122-160` — the manual freeze pipeline to share (raw render check → draft parse → freezable →
  design review → attachment verification → builder → duplicate check → persist last).
- Spec `.ai/specs/2026-09-18-delivery-os-hackathon.md:260` — "Replay before lock" for R7 proposals.
- `baselineContentV1Schema` is a non-strict `z.object`, contract v1 is additive-only (T020 precedent: optional fields).
- `commands/__tests__/baselines.test.ts` pins "no query after the row is persisted".

## What We're NOT Doing

- No plan-proposal import (R10, next L7 task), no design-manifest import, no task creation.
- No migration, no new error code, no new event, no new ACL feature, no UI/i18n (patch requests go to the hand-over).
- No carry-forward of import provenance into later manual baselines.
- No change to how decisions promote `activeBaselineId`.

## Implementation Approach

One private helper `freezeDraft(tx, ctx, scope, rawScreens, draft, options)` in `commands/baselines.ts` holds the shared
pipeline; the manual command calls it with `requireRender: true`, the import with `requireRender: false` plus the import
provenance. The import runs entirely inside one transaction: lock the project row → read the project's baselines →
replay check → (only for a new manifest) lock header + optimistic lock → validate/merge → freeze → mutate
`project.draftSpec` and persist the baseline as the last statements.

Decisions (self-answered planning questions):

1. **Where `manifestId` lives** → optional additive `importedManifests: [{ manifestId, manifestHash }]` on
   `BaselineContent v1`, written only by imports. Manual baselines never carry the key, so every existing hash and
   fixture is unchanged. No sixth table, no migration. `importedManifestHashes` keeps being filled.
2. **Replay before the optimistic lock** → yes (spec line 260). The first import bumps `project.updatedAt`, so an honest
   retry always has a stale header; replay is looked up over ALL baselines of the project under the row lock.
3. **Replay under the row lock, not before it** → one code path, race-free (two identical concurrent imports: the second
   waits, then sees the first row). Cost: a read-only replay takes a short row lock.
4. **Screens not required at import** → FROM_BRIEF requirements arrive before the design exists; AC are still required
   (the content schema answers `422 missing_acceptance_criteria`). Readiness keeps blocking `ready` without a render.
   When the draft already has screens, the same render/design/attachment checks as manual run.
5. **Response** → additive `projectUpdatedAt` (ISO) on both sources so an unattended client can continue with a fresh
   lock header without a GET.
6. **`parentBaselineId`** → `null` (the spec reserves the parent link for merged plan baselines).
7. **Validation before replay** → schema/version and `projectId` are checked first (a malformed replay is still 422);
   the replay check needs the manifest hash, so a small pure `parseRequirementsProposal` is split out of the validator.
8. **Body cap** → `readCappedRouteBody` with 8 000 000 bytes for every source on this route (same as the results route).

## Critical Implementation Details

- **State sequencing**: inside the transaction every read (project, baselines, attachments) happens before the first
  mutation; `project.draftSpec = …`, `project.updatedAt = new Date()` and `tx.persist(baseline)` are the last statements
  (core AGENTS rule; pinned by the "no query after persist" test, which gets an import twin).
- **Lock order**: `lockScopedProject` (row lock, 404) → replay → `requireLockHeader` (428) → `lockProjectForWrite(force)`
  (platform 409). `requireLockHeader` must NOT run before the replay check.
- **Error precedence (pinned by a test)**: 404 project → 400/422 manifest (schema, version, foreign project) → replay
  `200 duplicate` / `409 idempotency_conflict` → 428 → platform 409 → draft/freeze 4xx. This differs from the manual
  source (428 first) on purpose: a replay must not need a lock header.
- **Replay lookup** parses only `content.importedManifests` with its own small schema (rows without it are skipped); a
  replay answers `openCommentIds: []` because no freeze runs.
- **Project indexer config**: a local `projectCrudIndexer` const in `baselines.ts`, like `decisions.ts` does.
- **Live smoke**: the dev server bundles `packages/core/dist` — rebuild the core package and restart the server first.

## Phase 1: Contract, command and unit tests

### Overview

Additive contract field, parser split, shared freeze helper, the new command, unit tests.

### Changes Required:

#### 1. Contract

**File**: `packages/core/src/modules/delivery_os/lib/contracts.ts`

**Intent**: Let baseline content remember which manifest ids were imported.

**Contract**: `baselineContentV1Schema` gains `importedManifests: z.array(z.object({ manifestId: manifestIdSchema, manifestHash: sha256Schema })).max(50).optional()`. `manifestIdSchema` moves above the baseline schema if needed.

#### 2. Builder

**File**: `packages/core/src/modules/delivery_os/lib/baseline.ts`

**Intent**: Pass import provenance through the one builder.

**Contract**: `BaselineBuildExtras` gains `importedManifests?`; the key is added to the candidate only when non-empty.

#### 3. Parser split

**File**: `packages/core/src/modules/delivery_os/lib/proposals.ts`

**Intent**: Expose the manifest identity without needing a draft.

**Contract**: `parseRequirementsProposal(manifest, projectId)` → `{ ok: true, manifest, manifestId, manifestHash } | ProposalFailure`; `validateRequirementsProposal` uses it, behaviour unchanged.

#### 4. Command

**File**: `packages/core/src/modules/delivery_os/commands/baselines.ts`

**Intent**: Extract `freezeDraft`, add `checkDraftFreezable(draft, { requireRender })`, register `delivery_os.baselines.import_requirements`, return `projectUpdatedAt` from both commands.

**Contract**: input `{ projectId, source: 'requirements_proposal', manifest }`; result `BaselineCommandResult & { projectUpdatedAt }`; errors per Desired End State; unique violation recovered as duplicate; side effects (baseline `created`, project `updated`) only after commit and only when not duplicate; audit label key `delivery_os.audit.baselines.import_requirements`, `snapshotAfter` carries `manifestId` + `manifestHash`.

#### 5. Unit tests

**Files**: `commands/__tests__/baselines.test.ts`, `lib/__tests__/{proposals,baseline,contracts}.test.ts` (as needed), `commands/__tests__/baselineTestKit.ts` (helper for a proposal bound to `PROJECT_ID`)

**Intent**: Prove the acceptance list at command level.

**Contract**: legs — happy path (version, source, schema + `hashCanonical`, provenance, draft copied, locked load, persist last); manual and imported content parse with the same schema and hash with the same function; import while a baseline is approved → n+1, `activeBaselineId` and old row untouched; replay → `duplicate: true`, no `persist`, also with stale/missing header; same `manifestId` other content → 409 `idempotency_conflict`; unknown version → 422; foreign project id → 422; no AC → 422; stale header on a new manifest → 409 platform; missing header → 428; no screens allowed; unique-violation recovery; foreign org → 404.

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os/commands src/modules/delivery_os/lib --maxWorkers=2` green
- Existing fixture hashes unchanged (fixtures/contracts suites green without fixture edits)

---

## Phase 2: Route wiring, docs and live check

### Overview

Dispatch by source on R7, cap the body, document, test at route level, update spec + hand-over, smoke on :3100.

### Changes Required:

#### 1. Route

**File**: `packages/core/src/modules/delivery_os/api/projects/[id]/baselines/route.ts`

**Intent**: `COMMAND_BY_SOURCE` next to `FEATURE_BY_SOURCE`; capped body; response adds `projectUpdatedAt`; openApi description and error list (409 `idempotency_conflict`, 413, 422 proposal codes).

#### 2. Schemas

**File**: `packages/core/src/modules/delivery_os/api/schemas.ts`

**Contract**: `baselineCreateResponseSchema` gains optional `projectUpdatedAt: z.string()`.

#### 3. Route tests

**File**: `packages/core/src/modules/delivery_os/api/__tests__/baselines.route.test.ts`

**Contract**: replace the `unsupported_source` test with: 403 manage-only; 201 then 200 duplicate (stale header, `routeState.writes` unchanged); 409 `idempotency_conflict`; 409 platform stale; 422 unknown `schemaVersion`; 422 foreign `projectId`; 404 foreign tenant/org; 413 oversized body.

#### 4. Docs

**Files**: `.ai/specs/2026-09-18-delivery-os-hackathon.md` (UA-06 row, R7 note, changelog entry), `context/changes/delivery-os-oss-domain/handover/OSS-03-L7c-requirements-import.md` (new).

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` green
- `yarn workspace @open-mercato/core typecheck` (or the package's tsc equivalent) clean, plus a temporary tsconfig check of the touched test files
- `yarn lint` scoped to the core package shows no new findings in touched files
- Live smoke against http://localhost:3100 after a dev-server restart: 201 → 200 duplicate → 409 conflict → 422 unknown version

#### Manual Verification:

- UI-03/QA-03 confirm the import from the real proposal flow (joint acceptance, human only)

---

## Testing Strategy

### Unit Tests:

Command legs and route legs listed above; the EM spy (`persist` not called, `routeState.writes` unchanged) proves "no row on re-import".

### Integration Tests:

`TC-DELIVERY-002` belongs to QA; the hand-over lists the scenario and payloads.

### Manual Testing Steps:

1. Create a project, PUT a draft, POST the requirements proposal, GET baselines — version 1 `requirements_proposal`, project draft shows the imported requirements.

## Performance Considerations

One extra locked project read per import; baselines per project are few. Body capped at 8 MB, manifest at 2 M chars.

## Migration Notes

None. Additive optional contract field; strict copies of `BaselineContent v1` in other streams must allow `importedManifests`.

## References

- Research: `context/changes/asd-oss-t021-oss-03-l7c-add-requirements-proposal/research.md`
- Manual path: `packages/core/src/modules/delivery_os/commands/baselines.ts:103`
- Spec: `.ai/specs/2026-09-18-delivery-os-hackathon.md:260,300`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Contract, command and unit tests

#### Automated

- [x] 1.1 delivery_os commands + lib jest suites green
- [x] 1.2 Existing fixture hashes unchanged

### Phase 2: Route wiring, docs and live check

#### Automated

- [x] 2.1 Full delivery_os jest scope green
- [x] 2.2 Core typecheck clean including touched test files
- [x] 2.3 Lint shows no new findings in touched files
- [x] 2.4 Live smoke on :3100 (201, 200 duplicate, 409 conflict, 422 unknown version)

#### Manual

- [ ] 2.5 UI-03/QA-03 confirm the import from the real proposal flow
