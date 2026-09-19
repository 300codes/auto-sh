# OSS-02 (H9) OSS-only Gate, Live Smoke and Hand-over Implementation Plan

## Overview

Close OSS-02 with evidence rather than new features: rebuild the OSS-only registries with enterprise modules off, run
the capped gate once (sequential, foreground, capped parallelism), smoke the manual flow live on
`http://localhost:3100`, and write the H9 hand-over `context/changes/delivery-os-oss-domain/handover/OSS-02-H9.md`
that other streams and the human acceptor read (UA-29, BN-16).

## Current State Analysis

- `delivery_os` (T004–T017) has five entities, migration, commands, routes R1–R16, ACL, setup, events, DI query
  service `deliveryOsAttemptQueries` and the `delivery_os.project.execution` spot. The last recorded jest run was
  30 suites / 685 tests (T017).
- `apps/mercato/src/modules.ts:107` registers `delivery_os` from `@open-mercato/core` unconditionally. Enterprise modules
  are gated at `modules.ts:197-218` by `OM_ENABLE_ENTERPRISE_MODULES` (default false). `apps/mercato/.env:135` already
  has it `false`, so the running dev server on :3100 is OSS-only.
- Generated registries live in `apps/mercato/.mercato/generated/` (gitignored; per-module API shards).
- Local DB has one tenant (Acme Corp) with one organization, so there is no second org to probe with.
- A previous live script (`/tmp/t016/live.ts`, not in repo) already drives R2→R16 with a real attachment upload.
- Hand-over notes so far: `OSS-01-*`, `OSS-02-H4-contracts.md`, `OSS-02-L1-L3-progress.md` (with T009–T017 addenda).
- T006 left two patch requests for files outside OSS ownership: `yarn template:sync` drift on `modules.ts`
  (create-app template) and `packages/core/src/__tests__/optimistic-lock-editable-entities.test.ts` not listing
  `delivery_os`.

## Desired End State

- The gate ran once, sequentially, with `OM_ENABLE_ENTERPRISE_MODULES=false`; every command's exit code and test
  counts are recorded, and failures (if any) are fixed in OSS files or listed with cause.
- The generated registries were read and confirmed to contain delivery_os routes, commands, events and ACL with no
  enterprise module present.
- A live transcript shows: reserve `201` then `200` (same attempt), package GET leaving row counts / `updated_at` /
  register unchanged, result import `201` then `200 duplicate:true`, and a cross-scope probe answering `404`; records
  removed afterwards.
- `OSS-02-H9.md` exists with SHA, versions, what works, commands + results, NOT RUN items, limitations, Progress rows
  with evidence, and patch requests for other owners.
- `git status` shows only OSS-owned files and this change folder modified.

### Key Discoveries:

- `packages/core/src/modules/delivery_os/lib/contracts.ts:4` — `DELIVERY_CONTRACT_VERSION = 1`.
- `packages/core/src/modules/delivery_os/lib/targetProfiles.ts:64,92,113` — three profiles at version 1.
- `apps/mercato/src/modules.ts:197-218` — enterprise gating; `delivery_os` independent of it.
- `packages/core/tsconfig` excludes `__tests__`, so typecheck does not cover tests (T017 note) — jest does.
- Master plan Progress 2.3 has two halves; the "with enterprise the extension appears" half belongs to EXEC.

## What We're NOT Doing

- No new features, routes (R17–R22), commands or error codes.
- No edits to generated files, the master plan, workstream docs, UI/enterprise/QA files, the create-app template,
  `scripts/template-sync.ts` or `optimistic-lock-editable-entities.test.ts` (patches are described instead).
- No full-repo gate (`build:app`, full `yarn test`) — deferred to OSS-06 per the recorded decision.
- No committed live-smoke script: it lives in `/tmp/t018/` and its transcript is quoted in the hand-over.
- No ticking of master-plan Progress rows or of this plan's Manual rows.

## Implementation Approach

Three phases in order: gate → live smoke → hand-over. Heavy commands run one at a time in the foreground with
`--concurrency=2` / `--maxWorkers=2`. A failure in an OSS-owned file is fixed and the affected command re-run; a
failure outside OSS ownership is recorded with its cause and a patch request.

Decisions made (autonomous mode; questions answered from spec, rules and codebase):

| # | Question | Choice | Why |
|---|---|---|---|
| D1 | Cross-scope probe with only one seeded org | Insert one `delivery_projects` row directly in SQL under a random foreign organization/tenant id, probe it with admin (GET R5, PUT R3, R9 list, task routes), plus a random UUID; delete the row afterwards | A real foreign row answering 404 proves the scope filter, not just absence; creating a second tenant via superadmin leaves residue outside delivery tables. |
| D2 | Live smoke vehicle | `/tmp/t018/live.ts` tsx script derived from the T016 script, transcript saved to `/tmp/t018/live.log` and quoted | Repeatable, not shipped in repo (the in-process suite is the repo-level evidence). |
| D3 | Rebuild side effects on the shared dev server | Run `turbo build` for core only; if the dev server stops answering afterwards, restart it the documented way | Dev server is shared infrastructure; build rewrites `dist` only. |
| D4 | i18n checks | Run `yarn i18n:check-sync` and `yarn i18n:check-usage`, record exit code and the delivery_os-relevant lines; advisory | Spec of the task says advisory; UI owns `delivery_os/i18n/**`. |
| D5 | Template sync | Run `yarn template:sync` (check mode), record result as a patch request, never `:fix` | Script and template are not OSS-owned (T006 D8). |
| D6 | 2.3 enterprise half | Report NOT RUN (EXEC scope) and cite the one-directional boundary test instead | OSS never imports enterprise (BN-14). |

## Phase 1: OSS-only capped gate

### Overview

Regenerate with enterprise off, then build, typecheck, lint and test the core package scope, one command at a time.

### Changes Required:

#### 1. Gate run (no file changes expected)

**File**: none (logs to `/tmp/t018/*.log`)

**Intent**: Produce exact commands, exit codes and counts for the hand-over.

**Contract**: Commands in order —
`OM_ENABLE_ENTERPRISE_MODULES=false yarn generate`;
`yarn turbo run build --filter=@open-mercato/core --concurrency=2`;
`yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2`;
`npx eslint packages/core/src/modules/delivery_os`;
`yarn workspace @open-mercato/core jest src/modules/delivery_os src/__tests__/module-decoupling.test.ts --maxWorkers=2`;
`yarn i18n:check-sync`; `yarn i18n:check-usage`; `yarn template:sync`.

#### 2. Generated registry check

**File**: `apps/mercato/.mercato/generated/*` (read only)

**Intent**: Confirm delivery_os routes (R1–R16 paths), commands, events, ACL features and the spot are present and no
enterprise module (`record_locks`, `agent_orchestrator`, `sso`, `security`) is registered.

**Contract**: grep evidence recorded in the hand-over. `yarn generate` runs through turbo, whose strict env mode may not
pass `OM_ENABLE_ENTERPRISE_MODULES` to the task; the effective value also comes from `apps/mercato/.env:135` (`false`), so
OSS-only is proven by the generated module list (no enterprise ids), not by the shell variable alone.

#### 3. Defect fixes (conditional)

**File**: only `packages/core/src/modules/delivery_os/**` OSS-owned paths

**Intent**: Fix a gate failure caused by OSS code and re-run that command; otherwise record the cause.

### Success Criteria:

#### Automated Verification:

- OSS-only generate exits 0: `OM_ENABLE_ENTERPRISE_MODULES=false yarn generate`
- Core build exits 0: `yarn turbo run build --filter=@open-mercato/core --concurrency=2`
- Core typecheck exits 0: `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2`
- ESLint on delivery_os is clean: `npx eslint packages/core/src/modules/delivery_os`
- delivery_os + decoupling jest green: `yarn workspace @open-mercato/core jest src/modules/delivery_os src/__tests__/module-decoupling.test.ts --maxWorkers=2`
- Generated registries contain delivery_os routes/commands/events/ACL and no enterprise module
- i18n sync/usage and template sync results recorded (advisory)

---

## Phase 2: Live OSS-only smoke

### Overview

Drive the manual flow once against :3100 as admin, probe a foreign scope, clean up.

### Changes Required:

#### 1. Live script

**File**: `/tmp/t018/live.ts` (outside the repo)

**Intent**: Login → R2 project → real attachment upload → R3 draft → R7 baseline → R8 requirements + design decisions →
R10 task → R12 ready → R14 reserve (`201`, replay `200`) → R15 package ×2 with DB snapshot before/after → R16 import
(`201`, replay `200 duplicate:true`) → R5 detail; a stale-update probe (PUT R3 with the pre-draft project `updatedAt`
→ platform `409`); cross-scope probe on a SQL-inserted foreign project and a random UUID
(`404`); delete all created rows and the attachment.

**Contract**: transcript `/tmp/t018/live.log`, quoted in the hand-over; residue check prints 0.

### Success Criteria:

#### Automated Verification:

- Live transcript shows reserve 201/200 with the same attemptId
- Live transcript shows package GET did not change row counts, task `updated_at` or register length
- Live transcript shows result import 201 then 200 duplicate:true with one evidence row
- Cross-scope probe answers 404 for the foreign row and the random UUID
- Stale project update answers 409
- Cleanup leaves no smoke records

#### Manual Verification:

- Operator walks the OSS-only flow in the UI (master-plan 2.4, human acceptance)

---

## Phase 3: H9 hand-over

### Overview

Write the hand-over note and verify the ownership boundary.

### Changes Required:

#### 1. Hand-over note

**File**: `context/changes/delivery-os-oss-domain/handover/OSS-02-H9.md`

**Intent**: Single document for UA-29: base commit SHA, `DELIVERY_CONTRACT_VERSION` and profile versions, what works
(R1–R16, DI service, events, spot), gate commands with exit codes and counts, live transcript excerpt, NOT RUN items,
limitations (R17–R22 pending, attachment byte verification pending, two-connection races with QA, enterprise half of
2.3), Progress rows with evidence (2.1, 2.2, 2.3; 2.4 human), patch requests (i18n keys for error codes/audit labels/ACL
titles, template sync, optimistic-lock editable-entities test).

#### 2. Ownership check

**Intent**: `git status --short` lists only OSS-owned paths and this change folder.

### Success Criteria:

#### Automated Verification:

- Hand-over file exists with commands, exit codes and test counts
- `git status --short` shows no file outside OSS ownership

---

## Testing Strategy

### Unit Tests:

- Existing delivery_os suites plus `module-decoupling.test.ts`; no new tests unless a defect fix needs one.

### Integration Tests:

- Live smoke on :3100 (Phase 2); Playwright TC-DELIVERY-* belong to QA.

### Manual Testing Steps:

1. Operator creates a project, enters requirements and two dependent tasks, exports the package in the UI (2.4).

## References

- Master plan Progress: `context/changes/autonomous-software-delivery/plan.md` § Progress (2.1–2.4)
- Prior hand-over: `context/changes/delivery-os-oss-domain/handover/OSS-02-L1-L3-progress.md`
- Prior live script: `/tmp/t016/live.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: OSS-only capped gate

#### Automated

- [x] 1.1 OSS-only generate exits 0
- [x] 1.2 Core build exits 0
- [x] 1.3 Core typecheck exits 0
- [x] 1.4 ESLint on delivery_os is clean
- [x] 1.5 delivery_os + decoupling jest green
- [x] 1.6 Generated registries contain delivery_os routes/commands/events/ACL and no enterprise module
- [x] 1.7 i18n sync/usage and template sync results recorded (advisory)

### Phase 2: Live OSS-only smoke

#### Automated

- [x] 2.1 Live transcript shows reserve 201/200 with the same attemptId
- [x] 2.2 Live transcript shows package GET did not change row counts, task updated_at or register length
- [x] 2.3 Live transcript shows result import 201 then 200 duplicate:true with one evidence row
- [x] 2.4 Cross-scope probe answers 404 for the foreign row and the random UUID
- [x] 2.5 Stale project update answers 409
- [x] 2.6 Cleanup leaves no smoke records

#### Manual

- [ ] 2.7 Operator walks the OSS-only flow in the UI (master-plan 2.4, human acceptance)

### Phase 3: H9 hand-over

#### Automated

- [x] 3.1 Hand-over file exists with commands, exit codes and test counts
- [x] 3.2 git status shows no file outside OSS ownership
