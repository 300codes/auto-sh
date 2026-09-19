# OSS-02 (L4b): project commands with archive guard and optimistic lock — Implementation Plan

## Overview

Add the first write path of `delivery_os`: `commands/shared.ts` (scope, scoped loaders, error and lock helpers)
and `commands/projects.ts` with `delivery_os.projects.create`, `.update`, `.delete`, registered at import time,
plus unit tests. The route layer (next task) only maps HTTP to these commands.

## Current State Analysis

`delivery_os` has entities, validators, the error catalogue, pure domain rules (`lib/*`), ACL, setup and events.
There is no `commands/` folder, so nothing can write a project. Research: `research.md` in this folder.

## Desired End State

`commandBus.execute('delivery_os.projects.create' | '.update' | '.delete', …)` works for a scoped actor:
tenant/org always come from the session, foreign ids answer 404, invalid drafts answer the frozen
`{ error, code, details[] }` body, a stale `updatedAt` answers the platform 409, and archive is refused while
an execution is live or unknown. Verified by `yarn workspace @open-mercato/core jest
src/modules/delivery_os/commands --maxWorkers=2` and a scoped typecheck.

### Key Discoveries:

- Command files are auto-discovered; `index`, `shared`, `factory` are skipped and ids are read statically
  (`packages/cli/src/lib/generators/module-registry.ts:1329-1460`) → literal ids, run `yarn generate`.
- Command-side lock: `enforceCommandOptimisticLockWithGuards` + `enforceRecordGoneIsConflict`
  (`packages/core/src/modules/customers/commands/pipelines.ts:62-75`).
- Row lock: `findOneWithDecryption(..., { lockMode: LockMode.PESSIMISTIC_WRITE }, scope)` inside
  `em.transactional` (`packages/core/src/modules/warranty_claims/commands/claims.ts:2204-2218`).
- The spec renamed `active_attempt` → `attempt_active` and adds `reconciliation_required` for archive
  (`.ai/specs/2026-09-18-delivery-os-hackathon.md:298,329,333,425`). The spec wins over the task wording.
- `DeliveryProject` has no status column; "status draft" is what `lib/projectStatus.ts` derives for a new project.

## Decisions (self-answered planning questions)

| # | Question | Choice | Why |
|---|---|---|---|
| 1 | Where does scope come from? | `ctx.auth.tenantId` and `ctx.selectedOrganizationId ?? ctx.auth.orgId`, then `ensureTenantScope`/`ensureOrganizationScope`. Input `tenantId`/`organizationId` are never read (zod strips them). | Tenant isolation is never on the cut list; the selected org is session state validated by the platform, not body input. |
| 2 | Validation error shape | `safeParse` + `deliveryErrorFromZod` → `CrudHttpError(status, body)` | Frozen v1 body for UI/QA; a raw ZodError would give the platform's generic 400. |
| 3 | Archive error codes | active attempt or `executing` task → `409 attempt_active`; `reconciliation_required` attempt, task `statusReason = reconciliation_required`, or unreadable register → `409 reconciliation_required` | Spec catalogue; unreadable state fails closed ("unknown blocks archive"). |
| 4 | Which task statuses are "active"? | `executing` only | The only status with a possibly running external process; `awaiting_review` etc. have a closed/received attempt. |
| 5 | Optimistic lock | Checked inside the transaction after the `PESSIMISTIC_WRITE` row lock, with the platform helper and platform 409 body; no header → no check in the command | Check and write are atomic; `surfaceRecordConflict` in the UI keys off the platform body. `428 optimistic_lock_required` is a route concern (workers call commands without headers). |
| 6 | Undo | No `undo` handlers; `buildLog` with before/after snapshots only | Undoing an archive or a draft overwrite would bypass domain guards; audit trail is what judges need ("who decided what"). |
| 7 | Side effects | `emitCrudSideEffects` with `indexer: { entityType: E.delivery_os.delivery_project }`, no CRUD `events`; `emitDeliveryOsEvent('delivery_os.project.created')` once after commit | T009 decision: events only from commands with the frozen payload; index stays consistent whichever list strategy the route picks. |
| 8 | Newest profile version | new pure helper `getLatestTargetProfile(id)` in `lib/targetProfiles.ts` | Profiles are data; commands must not hard-code versions. |
| 9 | `limits` on update | merged over the stored limits; on create merged over `DEFAULT_DELIVERY_LIMITS` | The validator accepts a partial object; a partial must not erase other limits. |
| 10 | `draftSpec` on update | full replacement with the parsed (defaults-filled) value; `activeBaselineId` and baselines untouched | Task text; append-only scope (BN-05). |

## What We're NOT Doing

- No API routes, OpenAPI, `428` enforcement, list/detail DTOs (next task).
- No task/baseline/decision/attempt commands; no cascade on archive; no undo/redo.
- No attachment verification of `draftSpec.attachments` (OSS-03, recorded decision).
- No UI, i18n files or integration tests (other streams). Audit labels use `translate(key, fallback)`; the
  keys `delivery_os.audit.projects.{create,update,delete}` are handed to the UI stream.

## Implementation Approach

Two phases: helpers first (small, separately tested), then the three commands with their tests, generation and
verification.

## Critical Implementation Details

- **State sequencing**: in `update`/`delete` the order is: open transaction → load project with row lock (404 /
  gone-is-conflict) → optimistic-lock check → (delete: load tasks, archive guard) → mutate → commit → side
  effects and events. Side effects and `emitDeliveryOsEvent` run only after the transaction resolves.
- **Archive race (plan-review F1)**: delete locks the project row and then the project's live task rows, so a
  concurrent reservation (which locks the task row) either finishes first and blocks the archive, or waits and
  must then find the project archived. Lock order is always project → tasks. Hand-over for the attempts task:
  after locking the task, load the project with `deletedAt: null`.
- **Atomic flush**: inside the transaction all reads happen before the scalar mutations; no query runs between a
  mutation and the flush.

## Phase 1: Shared command helpers

### Overview

Scope resolution, scoped loaders, error conversion and the row-lock transaction helper, plus the latest-profile
lookup.

### Changes Required:

#### 1. Command helpers

**File**: `packages/core/src/modules/delivery_os/commands/shared.ts`

**Intent**: One place for the safety rules every delivery command repeats, so later command files (tasks,
baselines, attempts, evidence) cannot forget tenant scope or the frozen error body.

**Contract**:
- `type DeliveryScope = { tenantId: string; organizationId: string }`
- `resolveDeliveryScope(ctx): DeliveryScope` — session only; missing tenant/org → `CrudHttpError(403,
  buildDeliveryError('forbidden', …).body)`.
- `deliveryHttpError(failure: DeliveryErrorResult): CrudHttpError` and `assertDeliveryCheck(result:
  DeliveryCheckResult): void`; messages that are not user copy carry the `[internal]` prefix at the call site.
- `parseDeliveryInput(schema, raw)` — `safeParse`, throws `deliveryHttpError(deliveryErrorFromZod(error))`.
- `requireScopedProject(em, id, scope, options?)`, `requireScopedTask(em, id, scope, options?)` —
  `findOneWithDecryption` filtered by `id + tenantId + organizationId + deletedAt: null`; miss → 404 `not_found`
  body (same answer for missing, archived and foreign).
- `lockScopedProject(tx, id, scope)` / `lockScopedTask(tx, id, scope)` — same loaders with
  `LockMode.PESSIMISTIC_WRITE`.
- `lockScopedProjectTasks(tx, projectId, scope)` — live tasks of the project via `findWithDecryption` with
  `LockMode.PESSIMISTIC_WRITE`. Commands call `em.transactional` directly (no wrapper; plan-review F2).
- `resolveEm(ctx)` — forked EM.

#### 2. Latest profile lookup

**File**: `packages/core/src/modules/delivery_os/lib/targetProfiles.ts` (+ its test)

**Intent**: Resolve the newest version of a profile id when the client omits the version.

**Contract**: `getLatestTargetProfile(id: string): TargetProfile | undefined` (highest `version`).

#### 3. Helper tests

**File**: `packages/core/src/modules/delivery_os/commands/__tests__/shared.test.ts`

**Intent**: Pin scope-from-session, the 404 for foreign scope (filter contains tenant + org + `deletedAt: null`),
the lock mode, and the error conversion (status + frozen body), each with a positive twin.

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os/commands src/modules/delivery_os/lib/__tests__/targetProfiles.test.ts --maxWorkers=2` passes

---

## Phase 2: Project commands

### Overview

`create`, `update`, `delete` with audit log metadata, registration, generation and verification.

### Changes Required:

#### 1. Commands

**File**: `packages/core/src/modules/delivery_os/commands/projects.ts`

**Intent**: The only legal way to write a project.

**Contract**:
- `delivery_os.projects.create` — input `ProjectCreateInput` (raw, validated inside); result `{ projectId }`.
  Unknown profile id or version → `422 unknown_target_profile` (detail path `targetProfileId` /
  `targetProfileVersion`). Stores the resolved version, merged limits, empty `draftSpec` parsed from `{}` so the
  stored shape is always DraftSpec v1. Emits `delivery_os.project.created` once with
  `{ projectId, tenantId, organizationId }` and options `{ persistent: true, tenantId, organizationId }`.
- `delivery_os.projects.update` — input `ProjectUpdateInput`; result `{ projectId }`. Only provided fields
  change; `draftSpec` replaces; `limits` merge; never writes `activeBaselineId`, `targetProfile*`, `inputMode`.
- `delivery_os.projects.delete` — input `{ body?, query? }` (id via `requireId`, then uuid-validated); result
  `{ projectId }`. Guard via `parseAttemptRegister`, `isAttemptActive`, `hasUnreconciledAttempt`; details list the
  blocking `taskId`/`attemptId`. Sets `deletedAt` only.
- Resource kind for lock and audit: `delivery_os.project`.
- `buildLog` for all three with `snapshotBefore`/`snapshotAfter` and `changes` (update).

#### 2. Registration

**File**: `packages/core/src/modules/delivery_os/commands/index.ts` — `import './projects'`.

#### 3. Tests

**File**: `packages/core/src/modules/delivery_os/commands/__tests__/projects.test.ts`

**Intent**: Mocked EM / DataEngine / events in the customers style. Pairs: body tenant/org ignored vs session
scope stored; unknown profile id and unknown version vs explicit and omitted version; defaults filled vs partial
override; event emitted once with trusted scope, none on failure; duplicate AC ids → 422 `duplicate_stable_id`
and anchor outside 0–1 → 422 `invalid_comment_anchor` vs valid draft replaced; update never touches
`activeBaselineId`; foreign-scope id → 404 on update and delete vs own scope; archive blocked by an active
attempt, a `cancel_requested` attempt, a `reconciliation_required` attempt, an unreadable register and an
`executing` task vs allowed with closed attempts (tasks untouched, `deletedAt` set, no `remove`); stale
`updatedAt` header → 409 on update and delete vs matching header and no header; no session tenant → 403.

#### 4. Generated registry and docs

Run `yarn generate` (command loader registry). Add a changelog line to
`.ai/specs/2026-09-18-delivery-os-hackathon.md` and a short section to
`context/changes/delivery-os-oss-domain/handover/OSS-02-L1-L3-progress.md`.

### Success Criteria:

#### Automated Verification:

- `yarn workspace @open-mercato/core jest src/modules/delivery_os/commands --maxWorkers=2` passes
- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` passes (no regression)
- Scoped typecheck of `@open-mercato/core` passes (`yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2`)
- `yarn generate` lists the three command ids in the generated command loader (`grep -c "delivery_os.projects\." apps/mercato/.mercato/generated/command-loaders.generated.ts`; the file is gitignored)
- No `any` and no inline comments in the new files (`grep`)

#### Manual Verification:

- A human confirms in the audit log UI that create/update/archive of a delivery project show readable entries (after the route task lands)

---

## Testing Strategy

### Unit Tests:

See Phase 1 §3 and Phase 2 §3. Every negative has a positive twin in the same `describe`.

### Integration Tests:

Owned by QA (TC-DELIVERY-001); they need the routes from the next task.

### Manual Testing Steps:

1. After the route task: `POST /api/delivery_os/projects` with a body carrying a foreign `tenantId` → stored under the session tenant.

## Performance Considerations

Archive loads all live tasks of one project (bounded by plan size, tens of rows) under one transaction.

## Migration Notes

None — no schema change.

## References

- Research: `context/changes/asd-oss-t010-oss-02-l4b-add-project-commands-with/research.md`
- `packages/core/src/modules/customers/commands/{tags,pipelines}.ts`, `warranty_claims/commands/{shared,claims}.ts`
- Spec: `.ai/specs/2026-09-18-delivery-os-hackathon.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared command helpers

#### Automated

- [x] 1.1 Helper and targetProfiles jest suites pass

### Phase 2: Project commands

#### Automated

- [x] 2.1 Commands jest suite passes
- [x] 2.2 Whole delivery_os jest suite passes
- [x] 2.3 Scoped typecheck of @open-mercato/core passes
- [x] 2.4 yarn generate lists the three command ids
- [x] 2.5 No any and no inline comments in new files

#### Manual

- [ ] 2.6 Human confirms readable audit entries after the route task lands
