# FLOW-F2 L17a — staff.link, comments.triage and the stage comment-thread seams

## Overview

Add the two F2 commands that do not need staff writes (`delivery_os.staff.link` F10, `delivery_os.comments.triage` F13) and make
the F8 stage decision read and write real `delivery_comment_threads` rows instead of the L14 stubs.

## Current State Analysis

- Entities, migration, encryption map, validators (`staffLinkCommandSchema`, `commentThreadTriageCommandSchema`) and contracts
  (`staffLinkSchema`, `commentThreadTriageRequestSchema`) exist since T053.
- `commands/stages.ts:146-158` holds the stubs `loadStageCommentThreads` (→ `[]`) and `recordThreadDeferrals` (no-op); the pure
  rule `planStageDecision` already consumes `CommentThreadRecord[]` and yields `ThreadDeferral[]`.
- Template for a project-locked command: `commands/flow.ts` `delivery_os.flow.pin`.
- Staff seam: DI key `timeTrackingAccessResolver.resolveProjectAccess` (staff/AGENTS.md); `canManageAll` means unrestricted.
- `appendOnly.test.ts` forbids `assign(`, `undo`, removal, and property assignment on variables named `*decision*`/`*baseline*`/`*evidence*`.

## Desired End State

`staff.link` and `comments.triage` registered and unit-tested; an approval is blocked by open un-triaged threads of the stage and
hash-bound deferrals are persisted on the thread rows inside the F8 transaction. Routes are L17b/L18 (not here).

## Decisions (self-answered planning questions)

| # | Question | Choice | Why |
|---|---|---|---|
| D1 | How is `canManageAll` derived? | `rbacService.getGrantedFeatures` + shared `hasFeature` (wildcards, superadmin `*`), fail closed; also pass the list as `userFeatures` | Same RBAC read as `stages.ts`; no staff import |
| D2 | Resolver missing | `422 staff_link_required` | Task + spec; OSS works without staff |
| D3 | Inaccessible/foreign staff project | `404 not_found`, identical body for both | No oracle |
| D4 | Re-link to another staff project | Allowed while no thread of the project has a staff card; afterwards `409 invalid_transition` (`staff_link_in_use`) | Cards already live in the old staff project; silent re-link would split one thread identity across boards |
| D5 | Staff project already linked to another delivery project (unique index) | `409 invalid_transition` (`staff_project_already_linked`), pre-check + unique-violation recovery | Caller can see that staff project anyway, so no oracle; deterministic error instead of 500 |
| D6 | Same id replay | `200` unchanged, answered on the probe before the lock header is required | Matches pin/artifact replay behaviour (T051 note) |
| D7 | Triage lock | thread `updatedAt` via `enforceCommandOptimisticLockWithGuards`, resource kind `delivery_os.comment_thread`; header required (428-style `optimistic_lock_required`) | Spec F13 |
| D8 | Deferral binding | artifact must be of the same project AND the thread's stage (`foreign_reference`), `contentHash` must match (`422 hash_mismatch`); `linkedDeliveryTaskId` must be a task of the same project (`foreign_reference`), `undefined` keeps, `null` clears; thread loaded by `{id, projectId, tenantId, organizationId}` | Spec F13 |
| D9 | Leaving `deferred` | `deferral` nulled whenever the new status is not `deferred` | T053 note; a stale deferral must not resurface |
| D10 | Thread loading | `findWithDecryption` (repo rule; rows are mutated in the tx), mapped to non-PII `CommentThreadRecord` | Convention beats the micro-optimisation; PII never leaves the loader |
| D11 | `recordThreadDeferrals` signature | gains `{ projectId, stageId, scope, actor, now }`; only rows that were blocking for the decided artifact are updated (a key may repeat across files) | Stub signature could not scope the write |
| D12 | Events | none new (no frozen event id for link/triage); audit log via `buildLog` | Additive-only contract; avoid inventing event ids other streams did not get in F0 |

Plan-review amendments (reviews/plan-review.md): (1) a `canManageAll` caller's id is probed through the query engine (`staff:staff_time_project`, scoped, fail closed → 404); (3) triage takes the project row lock, F8 row-locks the stage threads inside its transaction (order project → thread); (4) deferrals are written only on rows that were blocking; (6) a link write bumps `project.updatedAt`; (7) detail `staff_module_unavailable`; (8) order project → staff access → replay → lock header → tx; (11) `triaged` still blocks (tested).

## What We're NOT Doing

Routes, comment import (L17b), staff writes, i18n audit keys (UI owner patch request), new events, migrations.

## Phase 1: Commands and seams

### Changes Required

1. `commands/staffLink.ts` — **Intent**: F10 command. **Contract**: id `delivery_os.staff.link`, input `staffLinkCommandSchema`, result `StaffLink & { unchanged: boolean }`; exports `DELIVERY_STAFF_LINK_RESOURCE_KIND`, `loadStaffLink(em, projectId, scope)`, `toStaffLink(row)` for L17b/L18.
2. `commands/comments.ts` — **Intent**: F13 command. **Contract**: id `delivery_os.comments.triage`, input `commentThreadTriageCommandSchema`, result `{ threadId, projectId, triageStatus, updatedAt }`; exports `DELIVERY_COMMENT_THREAD_RESOURCE_KIND`, `loadStageThreadRows`, `toCommentThreadRecord`.
3. `commands/stages.ts` — replace the two stubs; the thread loader and mapper stay in `stages.ts` (`comments.ts` does not need them).
4. `commands/index.ts` — register `./staffLink`, `./comments`.
5. `commands/__tests__/baselineTestKit.ts` — `Store` gains optional-free arrays `staffLinks`, `commentThreads`, `commentReplies`; `rowsFor` maps the three entities.

### Success Criteria

#### Automated Verification

- New suites `staffLink.test.ts`, `comments.test.ts` pass
- `stages.test.ts` additions pass (blocking, deferral record, null-artifact thread, stale-hash deferral)
- Whole module jest green (`--maxWorkers=2`), incl. `appendOnly`, `scopeChange`, `flowRegression`
- Core typecheck green
- No import of staff modules under `delivery_os/commands`

## Testing Strategy

Unit tests with the command kit (mocked decryption helpers, in-memory store). Integration specs arrive with the routes (L18, TC-DELIVERY-FLOW-03/04).

## References

- Spec: `.ai/specs/2026-09-18-delivery-os-hackathon.md` § Flow delta v1, rows F10/F13
- `packages/core/src/modules/delivery_os/commands/flow.ts` (pin), `commands/stages.ts:146`
- `packages/core/src/modules/staff/AGENTS.md` (DI key)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Commands and seams

#### Automated

- [x] 1.1 New suites staffLink.test.ts and comments.test.ts pass
- [x] 1.2 stages.test.ts comment-thread additions pass
- [x] 1.3 Whole delivery_os jest suite green with --maxWorkers=2
- [x] 1.4 Core typecheck green
- [x] 1.5 No staff module import under delivery_os/commands
