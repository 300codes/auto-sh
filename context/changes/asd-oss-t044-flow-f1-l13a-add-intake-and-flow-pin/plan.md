# FLOW-F1 L13a — Intake and Flow-Pin Commands Implementation Plan

## Overview

Add the persistence layer for the brief wizard (F2 `delivery_os.intake.update`), the agent scoping proposal import
(F3 `delivery_os.intake.import_proposal`), template pinning (F4 `delivery_os.flow.pin`) and the trusted workflow
instance link (F5 `delivery_os.flow.link_instance`), plus the additive ACL features, events and the
`deliveryFlowTemplateProvider` DI seam declared in `.ai/specs/2026-09-18-delivery-os-hackathon.md` § Flow delta v1.
Routes (L14) and the stage commands (L13b) come in later tasks; this task makes the commands callable from the
command bus and fully tested with the in-memory kit.

## Current State Analysis

- `commands/shared.ts` provides scope resolution (`resolveDeliveryScope`), the 428 lock-header check
  (`requireLockHeader`), scoped loaders with `PESSIMISTIC_WRITE`, `lockProjectForWrite` (project optimistic lock
  through `enforceCommandOptimisticLockWithGuards`), `deliveryHttpError` / `parseDeliveryInput` (frozen error bodies).
- `commands/attempts.ts:369-422` is the trusted internal command pattern: refuse when `ctx.request` is set or the
  `trustedExecution` object was not issued in-process (`isIssuedTrustedExecution`), 403 `forbidden` with detail
  `trusted_execution_required`.
- `lib/intakeRules.ts` (T042) owns all intake logic: `applyIntakeUpdate`, `mergeScopingProposal`, `defaultIntake`,
  `hashScopingProposal`. `lib/flowRules.ts` owns `hashFlowTemplate`; `lib/flowTemplates.ts` owns
  `getBuiltInFlowTemplate` / `DEFAULT_FLOW_TEMPLATE` (`delivery-default@1`).
- Entities (T041): `DeliveryIntake` (unique per scope+project, own `updatedAt`, jsonb `brief`/`questions` in the
  encryption map), `DeliveryProject.flow*` nullable columns (`flowTemplateId/Version/Hash/Snapshot`, `flowPinnedAt`,
  `flowWorkflowInstanceId`, `flowWorkflowDefinitionId`).
- Validators (T041): `intakeUpdateCommandSchema { projectId, intake }`, `scopingProposalImportCommandSchema
  { projectId, proposal, trustedExecution? }`, `flowPinCommandSchema { projectId, templateId, templateVersion }`,
  `flowInstanceLinkCommandSchema { projectId, workflowInstanceId, definitionId, workflowId, version, trustedExecution }`.
- Contracts: `intakeResponseSchema { intake, targetProfile, updatedAt }`, `scopingProposalImportResponseSchema
  { projectId, manifestId, manifestHash, duplicate, intakeUpdatedAt }`, `flowPinResponseSchema { projectId, template
  { templateId, version, hash }, pinnedAt, projectUpdatedAt }`, flow error codes in `deliveryFlowErrorCodes`
  (`flow_already_pinned` 409, `flow_not_pinned` / `unknown_flow_template` / `flow_template_hash_mismatch` /
  `target_profile_frozen` 422), `buildDeliveryFlowError`.
- Tests: `commands/__tests__/baselineTestKit.ts` (in-memory `Store`, `makeHarness`, `expectFrozenBody`,
  `catchHttpError`); `scopeChange.test.ts:255-290` pins the exact command id set and `:308-318` the internal command
  ids; `__tests__/module-registration.test.ts` pins features, employee grants, event ids, broadcast flags and payload
  paths; `appendOnly.test.ts` scans command sources for forbidden mutation patterns (no history entity written here).
- `deliveryHttpError` accepts `{ status, body }`; `DeliveryFlowErrorResult` has the same shape with the wider code
  enum, so flow failures pass through it (the `CrudHttpError.body` is `Record<string, any>`).
- `enforceCommandOptimisticLock` is fail-open when no header is present; the 428 comes only from `requireLockHeader`
  (used by `baselines.ts:201`, `planImport.ts:190`), so in-process trusted callers without a request are never blocked.

## Desired End State

Four new commands registered through `commands/index.ts`, callable through the command registry, honoring scope, locks,
replay, trusted execution and the frozen error bodies; `acl.ts`, `setup.ts`, `events.ts`, `di.ts` extended additively;
`yarn generate` run; `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` green and the core
typecheck green. Verification: the acceptance commands below plus a live smoke of the DI default through the running
app is not possible without routes (L14), so the DI default is proven by a unit test.

### Key Discoveries:

- The intake lock is its own resource: first write compares the header with the project `createdAt` (the value F1
  returns when no row exists), later writes with `DeliveryIntake.updatedAt`; the project `updatedAt` never moves.
- The `DeliveryIntake` unique constraint per project plus a project row lock (`lockScopedProject`, no version check)
  serialize lazy creation, so no unique-violation recovery path is needed for the intake row.
- `mergeScopingProposal` is idempotent given the stored `importedManifests`; running it before the lock (replay probe)
  and again inside the transaction (authoritative) gives replay-before-lock without a second code path.
- The proposal document has no storage column (T041 scope); the intake stores the proposal ref (`manifestId`, hash,
  `proposedAt`, `status`) and the platform recommendation. The Scope content reaches the domain through the F7 stage
  artifact (`source: intake`) built by the caller from the same proposal. This is recorded as a limitation.
- `hashFlowTemplate` hashes the canonical template document; the spec's `flow_template_hash_mismatch` needs the
  provider to state the hash it publishes. The DI contract therefore accepts either a bare `FlowTemplateV1` (hash
  computed here) or `{ template, hash }` (hash verified) — additive to the spec's `FlowTemplateV1 | null` wording.
- `scopeChange.test.ts` scans every non-test module source for the internal command ids: `commands/flow.ts` must be
  added to the allowed sources for `delivery_os.flow.link_instance`, and no other file may mention that id.

## What We're NOT Doing

- No HTTP routes, OpenAPI or mutation guards (L14). No stage artifact / decision commands (L13b). No gate call sites
  in `tasks.ts` / `attempts.ts` / `decisions.ts` (L13b/C21).
- No new entities, columns or migrations; no storage of the full proposal document.
- No changes to frozen v1 commands, DTOs, events or fixtures; no `staff`/`workflows` coupling.
- No UI, i18n or enterprise files. No integration specs (`TC-DELIVERY-FLOW-*` ship with the routes in L14).

## Implementation Approach

Mirror the v1 command files one-to-one: parse with the command schema, resolve scope, do the pre-lock replay probe on a
forked `em`, then `em.transactional` with row locks, apply the pure rule, persist through the ORM (the encryption map
applies on flush), emit events after commit, and `buildLog` an audit entry. Keep the flow-template provider as a tiny
DI service so Marcin's workflows-backed provider replaces one registration.

## Critical Implementation Details

**Lock ordering.** F2: parse → scope → `requireLockHeader` → tx { lock project row (no version check) → load intake
with lock → `enforceCommandOptimisticLockWithGuards(resourceKind 'delivery_os.intake', current = intake?.updatedAt ??
project.createdAt)` → verify `brief.materials` attachments → `applyIntakeUpdate` → create/update row }. F3: parse →
scope → trusted-execution check → replay probe (unlocked read; duplicate → return without touching the lock) →
`requireLockHeader` only when `ctx.request` exists → tx { same locks and version check → `mergeScopingProposal` → persist }.
F4: parse → scope → unlocked project read (404) → pinned with the same id+version → stored body, `duplicate: true`, provider
never consulted (the snapshot wins, spec D7); pinned with another → 409 `flow_already_pinned`; unpinned → provider
lookup (422 `unknown_flow_template`) → hash check (422 `flow_template_hash_mismatch`) → `requireLockHeader` → tx {
`lockProjectForWrite` → re-check the pin state under the lock with the same rules → write-once }. Provider I/O never
runs under a row lock.
F5: trusted check → tx { `lockScopedProject` → `flow_not_pinned` / same instance no-op / other → `flow_already_pinned` }.

**Locked outcome is authoritative (F3).** Two concurrent imports of one manifest both pass the unlocked probe; the
second one finds the first's manifest under the lock and `mergeScopingProposal` answers `duplicate: true` — the
command then returns the replay shape and writes nothing; a hash conflict under the lock raises 409.

**Audit actor.** In-process trusted imports carry no `ctx.auth.sub`; `buildLog` stamps `actorUserId` from
`trustedExecution.actorUserId` like `attempts.ts:409`, and `createdBy` on a lazily created intake row is the parsed
`ctx.auth.sub`, else the trusted actor, else `null`.

**Reviewed ordering adjustments (impl review, 2026-09-19).** F2 verifies `brief.materials` on a forked em before the
transaction and requires the lock header unconditionally; F3 runs the locked merge before the intake version check so a
concurrent same-manifest import answers the replay shape; F4 takes the row lock, checks the pin state, then enforces
the project version only on the real-pin path. Responses are built after `em.transactional` resolves because the
entity `onUpdate` hook overrides a manually assigned `updatedAt` on UPDATE change sets.

**appendOnly scan.** `appendOnly.test.ts` flags any property assignment on a variable whose name contains `aseline`,
`vidence` or `ecision`; name locals in the new files accordingly (`intakeRow`, `locked`, `project`).

**Event payload types.** `EventPayloadSchemaField.type` must be one of the values `@open-mercato/shared/modules/events`
allows; check the union before declaring `downstreamNowStale` (array) — use `json` if available, otherwise `text`
with a note.

**Row-lock read on the intake.** `findOneWithDecryption(tx, DeliveryIntake, where, { lockMode: PESSIMISTIC_WRITE },
scope)` so the row is decrypted for the rule and locked for the write; the response is built from the in-memory
plaintext, never re-read after flush.

## Phase 1: Registries — ACL, setup, events, DI

### Overview

Additive declarations the commands depend on, plus the registration test update.

### Changes Required:

#### 1. ACL features

**File**: `packages/core/src/modules/delivery_os/acl.ts`

**Intent**: Declare `delivery_os.flow.manage`, `delivery_os.stages.approve`, `delivery_os.comments.import`, each
`dependsOn: ['delivery_os.projects.view']`, appended after the v1 list.

**Contract**: Feature ids exactly as the spec § Operations preamble; titles are short English labels like the v1 rows.

#### 2. Default role features

**File**: `packages/core/src/modules/delivery_os/setup.ts`

**Intent**: Append `delivery_os.comments.import` to `employee`; `admin` keeps the wildcard.

#### 3. Events

**File**: `packages/core/src/modules/delivery_os/events.ts`

**Intent**: Declare `delivery_os.flow.pinned { projectId, templateId, templateVersion, templateHash }`,
`delivery_os.stage.artifact_created { projectId, stageId, artifactId, version, contentHash, downstreamNowStale[] }`
(`clientBroadcast`), `delivery_os.stage.decided { projectId, stageId, artifactId, decisionId, verdict, currency }`
(`clientBroadcast`), `delivery_os.comment_thread.imported { projectId, threadId, staffTaskId, outcome }`; every payload
ends with the scope fields. Ids only, no PII.

**Contract**: `DELIVERY_OS_EVENT_IDS` grows to eight ids in declaration order (v1 four first).

#### 4. DI template provider

**File**: `packages/core/src/modules/delivery_os/di.ts` (+ new `commands/flowTemplateProvider.ts`)

**Intent**: Register `deliveryFlowTemplateProvider` with the OSS default: `getTemplate(templateId, version)` resolves
`getBuiltInFlowTemplate` and returns `null` otherwise.

**Contract**:
```ts
export type ResolvedFlowTemplate = { template: FlowTemplateV1; hash: string }
export type DeliveryFlowTemplateProvider = {
  getTemplate(templateId: string, version: number): Promise<FlowTemplateV1 | ResolvedFlowTemplate | null>
}
export const DELIVERY_FLOW_TEMPLATE_PROVIDER_KEY = 'deliveryFlowTemplateProvider'
```

#### 5. Registration test

**File**: `packages/core/src/modules/delivery_os/__tests__/module-registration.test.ts`

**Intent**: Extend the expected feature ids, employee grants, event ids, broadcast ids and payload paths; add a DI
test that `register(container)` exposes the provider and the default resolves `delivery-default@1` and `null` for an
unknown pair; keep the privileged-feature assertion for `flow.manage` and `stages.approve` away from employees.

### Success Criteria:

#### Automated Verification:

- Registration suite green: `yarn workspace @open-mercato/core jest src/modules/delivery_os/__tests__ --maxWorkers=2`

---

## Phase 2: Intake commands

### Overview

`commands/intake.ts` with `delivery_os.intake.update` and `delivery_os.intake.import_proposal`, registered in
`commands/index.ts`, with `commands/__tests__/intake.test.ts`.

### Changes Required:

#### 1. Shared helpers

**File**: `packages/core/src/modules/delivery_os/commands/shared.ts`

**Intent**: Add `DELIVERY_INTAKE_RESOURCE_KIND = 'delivery_os.intake'` and a scoped intake loader
(`findScopedIntake(em, projectId, scope, { lock })`) next to the project loaders.

#### 2. Intake commands

**File**: `packages/core/src/modules/delivery_os/commands/intake.ts`

**Intent**: Implement F2 and F3 per the lock ordering above. F2 needs no explicit stripping: `intakeUpdateRequestSchema`
omits `proposals`, zod drops unknown keys, and `applyIntakeUpdate` keeps the stored `proposals`; the test proves a
client-sent `proposals` key never lands. Materials
are verified with `verifyAttachmentReferences` mapped to `role: 'attachment'`, `path: brief.materials.<i>`
(`attachment_scope_mismatch` for a foreign attachment). F3 accepts an optional issued `trustedExecution` (in-process
agent, no request) and refuses a `trustedExecution` on an HTTP call or an un-issued object with 403
`trusted_execution_required`.

**Contract**:
```ts
export type IntakeUpdateCommandResult = IntakeResponse                     // { intake, targetProfile, updatedAt }
export type ScopingProposalImportCommandResult = ScopingProposalImportResponse // { projectId, manifestId, manifestHash, duplicate, intakeUpdatedAt }
```
`buildLog` on both (resource kind `delivery_os.intake`). The audit `snapshotAfter` is plain jsonb, so it carries only
`{ projectId, step, questionCount, proposalIds, platform.chosen }` — never the brief or question text (PII under the
encryption map).

#### 3. Registration

**File**: `packages/core/src/modules/delivery_os/commands/index.ts`

**Intent**: `import './intake'` and `import './flow'`.

#### 4. Tests

**File**: `packages/core/src/modules/delivery_os/commands/__tests__/intake.test.ts`

**Intent**: Store gains `intakes: Row[]` handled locally (kit `rowsFor` is extended for `DeliveryIntake`). Cases:
first write without header → 428 `optimistic_lock_required`; stale header (≠ project `createdAt` when no row) → 409
and no row created; fresh header creates the row with the project scope, `schemaVersion`, `createdBy`; body
`proposals` stripped; second write uses intake `updatedAt` and project `updatedAt` untouched; `platform.chosen` ≠
profile → 422 `target_profile_frozen`; `step: submitted` with an unanswered blocking question → 422
`intake_step_invalid`; foreign materials attachment → 422 `attachment_scope_mismatch`; foreign org → 404.
Proposal: first import 201-shape (`duplicate: false`, proposal ref appended, questions merged unanswered, recommendation
stored), replay same manifest → `duplicate: true` with no lock header and no write, same id other hash → 409
`idempotency_conflict`, foreign `projectId` in proposal → 400/422 `foreign_reference` (schema), `trustedExecution` over
HTTP → 403, forged object in-process → 403, issued in-process without header succeeds; intake locked with
`PESSIMISTIC_WRITE`; `emitDeliveryOsEvent` never called.

### Success Criteria:

#### Automated Verification:

- Intake suite green: `yarn workspace @open-mercato/core jest src/modules/delivery_os/commands/__tests__/intake.test.ts --maxWorkers=2`

---

## Phase 3: Flow commands, registry expectations, generate, typecheck

### Overview

`commands/flow.ts` with `delivery_os.flow.pin` and the trusted `delivery_os.flow.link_instance`, tests, the
`scopeChange.test.ts` expectation update, `yarn generate` and the core typecheck.

### Changes Required:

#### 1. Flow commands

**File**: `packages/core/src/modules/delivery_os/commands/flow.ts`

**Intent**: F4: resolve the provider from `ctx.container` (`DELIVERY_FLOW_TEMPLATE_PROVIDER_KEY`), `null` →
422 `unknown_flow_template`; parse the returned template with `flowTemplateV1Schema` and require `templateId`/`version`
equal to the request (else `unknown_flow_template`); compute `hashFlowTemplate`, compare with a provider-stated hash →
422 `flow_template_hash_mismatch`; `requireLockHeader`; tx `lockProjectForWrite`; unpinned → set the five flow columns
and `flowPinnedAt = now`; pinned with the same id+version → `duplicate: true`, same body from the stored columns;
other → 409 `flow_already_pinned`. Emit `delivery_os.flow.pinned` (persistent, scoped) only on a real pin. F5:
trusted-only like `registerInternalAttemptCommand`; tx `lockScopedProject`; not pinned → 422 `flow_not_pinned`; same
instance → `changed: false`; other instance already linked → 409 `flow_already_pinned`; else set
`flowWorkflowInstanceId` + `flowWorkflowDefinitionId`.

**Contract**:
```ts
export type FlowPinCommandResult = FlowPinResponse & { duplicate: boolean }
export type FlowInstanceLinkCommandResult = { projectId: string; workflowInstanceId: string; changed: boolean; projectUpdatedAt: string }
```

#### 2. Tests

**File**: `packages/core/src/modules/delivery_os/commands/__tests__/flow.test.ts`

**Intent**: Harness passes `deliveryFlowTemplateProvider` through `makeHarness({ services })`. Cases: pin once →
snapshot, hash, `pinnedAt`, project `updatedAt` bumped, event payload = ids + scope only (assert no key beyond the
declared paths); same template again → `duplicate: true`, identical body, no event; other template → 409
`flow_already_pinned`; unknown → 422 `unknown_flow_template` before any lock (no `transactional` call); provider hash
≠ computed → 422 `flow_template_hash_mismatch`; missing header → 428; stale → 409; foreign org → 404; project row
locked with `PESSIMISTIC_WRITE`. Link: HTTP call → 403; forged → 403; unpinned → 422 `flow_not_pinned`; first link sets
both ids; same instance → `changed: false`; other instance → 409.

#### 3. Existing expectations

**File**: `packages/core/src/modules/delivery_os/commands/__tests__/scopeChange.test.ts`

**Intent**: Add the four new ids to the sorted command list; add `delivery_os.flow.link_instance` to `internalIds`
and `commands/flow.ts` to the allowed sources of the internal-id scan.

#### 4. Generation and typecheck

**Intent**: `yarn generate` (commands are not discovered, but events/di are), then
`yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2`.

### Success Criteria:

#### Automated Verification:

- Flow suite green: `yarn workspace @open-mercato/core jest src/modules/delivery_os/commands/__tests__/flow.test.ts --maxWorkers=2`
- Whole command layer green incl. `scopeChange` and `appendOnly`: `yarn workspace @open-mercato/core jest src/modules/delivery_os/commands --maxWorkers=2`
- Module suites green incl. registration, enterprise boundary and decoupling: `yarn workspace @open-mercato/core jest src/modules/delivery_os src/__tests__/module-decoupling.test.ts --maxWorkers=2`
- `yarn generate` runs; no versioned generated file changes unexpectedly
- Core typecheck green: `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2`

---

## Testing Strategy

### Unit Tests:

- Lock order (428 before 409, replay before lock), stripping of `proposals`, frozen profile, manifest replay/conflict,
  write-once pin, hash mismatch, unknown template, trusted-only link, no PII in event payloads.

### Integration Tests:

- Deferred to L14 (`TC-DELIVERY-FLOW-01`) when the routes exist.

### Manual Testing Steps:

1. None in this task (no route yet); the human-acceptance rows of the master plan stay open.

## Performance Considerations

One intake row per project, read twice at most per import (probe + locked). No lists.

## Migration Notes

None; tables exist from T041.

## References

- Spec rows F2–F5, Events, DI: `.ai/specs/2026-09-18-delivery-os-hackathon.md` § Flow delta v1
- Pattern: `packages/core/src/modules/delivery_os/commands/attempts.ts:369-422`, `commands/baselines.ts:190-246`
- Rules: `packages/core/src/modules/delivery_os/lib/intakeRules.ts`, `lib/flowRules.ts:16`, `lib/flowTemplates.ts:97`
- Prior task notes: `context/changes/asd-oss-t042-*/plan.md`, `context/changes/asd-oss-t043-*/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Registries — ACL, setup, events, DI

#### Automated

- [x] 1.1 Registration suite green

### Phase 2: Intake commands

#### Automated

- [x] 2.1 Intake suite green

### Phase 3: Flow commands, registry expectations, generate, typecheck

#### Automated

- [x] 3.1 Flow suite green
- [x] 3.2 Whole command layer green incl. scopeChange and appendOnly
- [x] 3.3 Module suites green incl. registration, enterprise boundary and decoupling
- [x] 3.4 yarn generate runs without unexpected versioned changes
- [x] 3.5 Core typecheck green
