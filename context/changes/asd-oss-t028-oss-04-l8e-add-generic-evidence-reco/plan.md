# OSS-04 (L8e): generic evidence recording (R19) Implementation Plan

## Overview

Add the append-only command `delivery_os.evidence.record` and the route `POST /api/delivery_os/projects/:id/evidence`
(R19) for the kinds `test`, `screenshot`, `scan`, `deployment` and `reference_material`. The operator (UA-13) or the
WordPress PoC import (UA-27) records proof next to a project; the system validates it against the frozen baseline and
the target profile, stores it once, and never publishes or moves a task.

## Current State Analysis

- The request schema is frozen and tested (`data/validators.ts:292-441`, `parseRecordEvidenceBody`), but nothing consumes it.
- `commands/evidence.ts` holds only `delivery_os.results.accept`; it already has the evidence indexer and the emit pattern.
- `lib/resultChecks.ts#checkReportedChecks` was built for reuse (takes `pathPrefix`).
- `commands/attachments.ts#verifyAttachmentReferences` verifies scope, MIME, size and sha256 of stored files.
- `delivery_evidence` has a non-unique lookup index `(tenant, org, project, kind, payload_hash)`; no unique index for generic kinds.
- `reference_material` is ignored by `countsAsAcEvidence`, `checkVerification` and the traceability flag (tests exist);
  `deriveProjectStatus` has no such test.
- `commands/__tests__/scopeChange.test.ts` pins the command ids (:260), the append-only ids (:280) and the append-only routes (:293).

## Desired End State

`POST /projects/:id/evidence` answers `201 { evidenceId, duplicate: false }` for a valid body of the five kinds and
`200 { evidenceId, duplicate: true }` for an identical replay, with exactly one row. Bad proof is refused with the
frozen codes of the spec. `commands/__tests__/evidence.test.ts` and `api/__tests__/evidence.route.test.ts` are green
with `--maxWorkers=2`, the pinned guards are updated and green, and the spec has a changelog entry.

### Key Discoveries:

- Route shape to mirror: `api/tasks/[id]/results/route.ts` (scope-first 404, 8 MB cap, `pathInput` wins, `duplicate ? 200 : 201`).
- `executeDeliveryCommand` spreads `pathInput` last, so body `projectId` is overridden; the validator strips scope keys.
- `commands/tasks.ts` exports `findProjectBaseline`, `readBaselineContent`, `foreignBaselineError`, `unreadableBaselineError`, `requireTaskProfile`.
- `verifyAttachmentReferences` answers `attachment_scope_mismatch` / `missing_render` / `attachment_hash_mismatch` / `payload_too_large`.
- The route-scan test discovers `projects/[id]/evidence/route.ts` automatically, so its pinned list must gain the path.

## Decisions (questions answered by the developer in autonomous mode)

| # | Question | Decision | Why |
|---|----------|----------|-----|
| D1 | Where does the code live? | Command in `commands/evidence.ts`; pure rules in new `lib/evidenceRules.ts` | Task names the file; pure rules stay unit-testable like the rest of `lib/`. |
| D2 | How is idempotency made race-safe? | `lockScopedProject` row lock, then lookup by `(project, kind, taskId, attemptId, payloadHash)`; no migration | DB schema must not change in this task; the lock serializes writers of one project. |
| D3 | What is hashed? | `hashCanonical({ kind, baselineId, taskId, attemptId, sourceRevision, payload, attachmentIds })` with nulls for absent ids and sorted unique `attachmentIds`; derived fields are not hashed | The same proof for another baseline or revision is different proof. |
| D4 | Check order | scope/project 404 → schema → `review` stub → project lock → **replay** → baseline → task/attempt → profile kind → revision kind → kind rules → stored files → insert | Same as R16: a replay wins and never reads storage. |
| D5 | Body references that are foreign | baseline or live (`deletedAt: null`) task not in this project and scope → `422 foreign_reference` (`foreign_baseline` / `foreign_task`); unreadable attempt register → `409 reconciliation_required` via `unreadableRegisterError`; attempt not on the task → `404 attempt_not_found`; task or attempt pinned to another baseline → `422 baseline_mismatch` | Existing codes and patterns; the path project stays the only 404 `not_found`. |
| D6 | Test evidence without `taskId` | Validated against the whole baseline (all AC, full `acTestMap`); with `taskId` only the task's AC and their map entries | Validator allows it; the model still cannot add coverage mappings. |
| D7 | Screenshot file errors | role `screen` (image types only); `attachment_scope_mismatch` → `422 foreign_reference`, `payload_too_large` stays 413, every other verification failure → `422 hash_mismatch` with the original details | The spec lists `hash_mismatch` for R19. |
| D8 | Extra `attachmentIds` | Must exist in scope (one scoped lookup, no byte read) → else `422 foreign_reference` / `attachment_scope_mismatch`; stored ids = unique(base ∪ screenshot id) | Never reference a foreign file; no declared hash exists to compare. |
| D9 | Scan `checkId` | Refused only when it names a profile check of another kind (`422 unknown_test_id` / `check_id_mismatch`); unknown ids are stored | `wordpress-theme@1` permits scans but declares no scan check. |
| D10 | Deployment status | The system derives `verificationStatus` into the stored payload: `unverified` without `verification`; `verified` only when `verification.status = verified`, `observedBuildId = buildId` and `uploadStatus = succeeded`; otherwise `failed` | "The agent proposes, the system decides": a claimed verification of another build never counts. |
| D11 | Response | `{ evidenceId, duplicate }`; `taskStatus` / `taskUpdatedAt` stay optional in the schema and are never sent by L8e | Spec marks them optional; this task never moves a task. UI strict copies stay valid. |
| D12 | Source and actor | `source = 'manual'` always; `recordedBy` = signed-in user id when it is a uuid | R19 is the operator path; EXEC uses `results.accept`. |
| D13 | Event and audit | `evidence.recorded` on new and on duplicate (`completionDelivery: null`); audit entry only on a new row, label key `delivery_os.audit.evidence.record` | Same as R16; the frozen payload carries `duplicate`. |
| D14 | Kind vs profile | Profile = the task's pinned profile, else the project's; kind not in `permittedEvidenceKinds` → `422 unsupported_evidence_kind` / `kind_not_permitted_for_profile` | `reference_material` is a WordPress-only kind (UA-27). |
| D15 | `review` kind | `422 unsupported_evidence_kind` / `review_not_yet_supported`, before any lock | The next task (L8f) dispatches it; the commit stays working. |
| D17 | Baseline approval | Any baseline of the project is accepted, approved or not | Evidence is history of that baseline; proof is always computed per baseline and only an approved active baseline drives tasks and the report (plan review F3). |
| D16 | Lock header and guard | No optimistic-lock header; mutation guard with project resource, operation `custom` | Spec row R19 says "—"; nothing user-editable is changed. |

## What We're NOT Doing

- No `review` kind, no task status change, no publication, no deploy/release decisions (L8f, OSS-05).
- No migration, no new error code, event, ACL feature or DI key; no change to the frozen DTO or validators.
- No UI, i18n, integration spec or enterprise change (patch requests go to the hand-over).
- No comparison of `testDefinitionHash` (nothing frozen to compare with yet; noted for OSS-05).

## Implementation Approach

Pure rules first (`lib/evidenceRules.ts`), then the command that loads rows, calls the rules and writes one row in one
transaction under the project lock, then the thin route. Tests ship with each phase.

## Phase 1: Pure rules, command and pinned guards

### Overview

Everything except the HTTP route: the rules, the command, its unit tests, and the updated guards.

### Changes Required:

#### 1. Pure evidence rules

**File**: `packages/core/src/modules/delivery_os/lib/evidenceRules.ts` (new) + `lib/__tests__/evidenceRules.test.ts` (new)

**Intent**: Hold every rule that needs no database: the identity hash (D3), the test-check context cut from the
baseline (D6) and its call to `checkReportedChecks` with `pathPrefix: 'payload.checks.'`, the scan rule (D9), the
deployment status (D10), and the stored payload / `rawReportHash` selection.

**Contract**: `hashEvidenceIdentity(input): string | null`; `checkTestEvidence({ payload, sourceRevision, content, profile, taskAcIds? }): DeliveryCheckResult`;
`checkScanEvidence(profile, payload): DeliveryCheckResult`; `deriveDeploymentVerificationStatus(payload): 'unverified' | 'verified' | 'failed'`;
`buildStoredEvidence(input): { payload, rawReportHash }`. All return `DeliveryCheckResult` shapes from `lib/contracts.ts`.

#### 2. Scoped attachment existence

**File**: `packages/core/src/modules/delivery_os/commands/attachments.ts`

**Intent**: Add `verifyEvidenceAttachments` that verifies the screenshot reference through `verifyAttachmentReferences`
with the error mapping of D7 and checks the extra ids of D8 with one scoped lookup.

**Contract**: `verifyEvidenceAttachments(tx, ctx, { screenshot?: { attachmentId, sha256 }, attachmentIds }, scope): Promise<{ ok: true; attachmentIds: string[] } | ({ ok: false } & DeliveryErrorResult)>`.

#### 3. The command

**File**: `packages/core/src/modules/delivery_os/commands/evidence.ts`, `data/validators.ts` (only if a command-level type is needed; the body schema is untouched)

**Intent**: Register `delivery_os.evidence.record` following the order of D4; input is the route body plus
`projectId`. One transaction; emit the event and CRUD side effects after commit; `buildLog` returns `null` for a duplicate. No `undo`.

**Contract**: input `{ projectId, ...RecordEvidenceInput }`; result `EvidenceRecordCommandResult = { evidenceId: string; duplicate: boolean; kind }`.
Row: scope from the context only, `source: 'manual'`, `sourceRevision ?? null`, `payloadHash` = identity hash.

#### 4. Guards and projections

**File**: `commands/__tests__/scopeChange.test.ts`, `lib/__tests__/projectStatus.test.ts`

**Intent**: Pin the new id in both lists; assert that `reference_material` (and the other generic kinds) evidence leaves
`deriveProjectStatus` status and progress unchanged.

#### 5. Command tests

**File**: `commands/__tests__/evidence.test.ts` (new)

**Intent**: Cover every acceptance case at the command level with the harness pattern of `results.test.ts`
(store with `evidence` and `attachments`, fake inspector).

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2` passes
- `yarn workspace @open-mercato/core jest src/modules/delivery_os/commands --maxWorkers=2` passes
- Each of the five kinds is stored once; a replay answers `duplicate: true` with one row and no storage read
- `unknown_ac`, `unknown_test_id`, `baseline_mismatch`, `hash_mismatch`, `foreign_reference`, `deployment_incomplete`, `revision_kind_mismatch`, `unsupported_evidence_kind` cases are asserted
- Snapshot revision is accepted for `wordpress-theme@1` and refused for `react-vite@1`
- Deployment without verification is stored `unverified`; a verification of another build is stored `failed`
- No task row changes in any test; `reference_material` does not change progress

---

## Phase 2: Route, generation, documentation and live check

### Overview

Expose the command over HTTP, regenerate, document, and exercise it on the local instance.

### Changes Required:

#### 1. Route

**File**: `packages/core/src/modules/delivery_os/api/projects/[id]/evidence/route.ts` (new), `api/schemas.ts`

**Intent**: POST only; `requireFeatures: ['delivery_os.results.import']`; scope-first project lookup (404), 8 MB body
cap, `parseRecordEvidenceBody`, `executeDeliveryCommand` with `pathInput: { projectId }`, status `duplicate ? 200 : 201`, `openApi`.

**Contract**: response schema `evidenceRecordResponseSchema = { evidenceId, duplicate, taskStatus?, taskUpdatedAt? }` in `api/schemas.ts`.

#### 2. Route tests and route pin

**File**: `api/__tests__/evidence.route.test.ts` (new), `commands/__tests__/scopeChange.test.ts`

**Intent**: 201/200 replay, frozen response keys, feature metadata (403 without `results.import`), 401, 404 for a
foreign tenant and organization and a malformed id (scope before body), 413, body `tenantId` / `organizationId` /
`projectId` / `source` ignored, unknown kind 422, `review` stub 422; add the route path to the pinned append-only list.

#### 3. Generation and documents

**File**: `.ai/specs/2026-09-18-delivery-os-hackathon.md` (changelog + R19 notes), `context/changes/delivery-os-oss-domain/handover/OSS-04-L8e-evidence.md` (new)

**Intent**: Run `yarn generate`; record the rules, the order and the decisions; list patch requests for UI (i18n key
`delivery_os.audit.evidence.record`, evidence form, `verificationStatus`), EXEC and QA (TC-DELIVERY-008 candidates).

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` passes
- `yarn generate` completes and the route appears in the generated registry
- `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` passes
- `yarn turbo run lint --filter=@open-mercato/core --concurrency=2` passes
- Live smoke on http://localhost:3100: each kind 201, replay 200 with one row, deployment without `buildId` 422

#### Manual Verification:

- A human confirms in the UI/report (once UI-05 lands) that recorded evidence is visible and a deployment without verification shows as unverified

---

## Testing Strategy

### Unit Tests:

- `lib/__tests__/evidenceRules.test.ts`: hash stability (key order, attachment order, derived field excluded), test-check context with and without a task, scan rule, deployment status table.
- `commands/__tests__/evidence.test.ts`: acceptance list above, plus scope fields from the context, replay before validation, event payload, audit entry only once, no `undo`.
- `api/__tests__/evidence.route.test.ts`: HTTP surface.

### Integration Tests:

- Owned by QA (`TC-DELIVERY-008`); candidates are handed over. A live API smoke script is run as evidence.

## Performance Considerations

The project row lock is held for one insert and, for screenshots, one file read (a single screenshot, ≤ 10 MiB; kept inside the lock so a replay never reads storage). Test evidence is capped at 1000 checks by the schema.

## Migration Notes

None. No schema change.

## References

- Research: `context/changes/asd-oss-t028-oss-04-l8e-add-generic-evidence-reco/research.md`
- Sibling command and route: `packages/core/src/modules/delivery_os/commands/evidence.ts`, `api/tasks/[id]/results/route.ts`
- Spec: `.ai/specs/2026-09-18-delivery-os-hackathon.md` (R19 :285, UA-13 :308, event :221)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pure rules, command and pinned guards

#### Automated

- [x] 1.1 lib tests pass with --maxWorkers=2
- [x] 1.2 commands tests pass with --maxWorkers=2
- [x] 1.3 Each of the five kinds is stored once and a replay is a duplicate with one row and no storage read
- [x] 1.4 Refusal codes are asserted (unknown_ac, unknown_test_id, baseline_mismatch, hash_mismatch, foreign_reference, deployment_incomplete, revision_kind_mismatch, unsupported_evidence_kind)
- [x] 1.5 Snapshot revision accepted for wordpress-theme@1 and refused for react-vite@1
- [x] 1.6 Deployment without verification stored unverified and a verification of another build stored failed
- [x] 1.7 No task row changes and reference_material does not change progress

### Phase 2: Route, generation, documentation and live check

#### Automated

- [x] 2.1 Whole delivery_os jest folder passes with --maxWorkers=2
- [x] 2.2 yarn generate completes and the route is registered
- [x] 2.3 Core typecheck passes with --concurrency=2
- [x] 2.4 Core lint passes with --concurrency=2
- [x] 2.5 Live smoke on localhost:3100 (201 per kind, replay 200 with one row, deployment without buildId 422)

#### Manual

- [ ] 2.6 A human confirms recorded evidence and the unverified deployment state in the UI/report
