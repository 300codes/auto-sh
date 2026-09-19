# OSS-06 Full Capped Gate & OSS-only Reproduction Implementation Plan

## Overview

Feature freeze for `delivery_os`. Run the CI-mirroring gate once, one heavy command at a time in the
foreground with the RAM caps from ENVIRONMENT.md, reproduce the OSS-only build, fix only defects inside
OSS ownership, and write a gate record (`OSS-06-gate.md`) where every step has command, runner, duration,
exit code and commit SHA — steps not run are reported as not run.

## Current State Analysis

- HEAD `35e77c4dd` on `dev-mateusz`, tree clean. Dev server on :3100 answers 200 (`yarn dev` pid tree alive).
- `jest.config.base.cjs:39` already sets `maxWorkers: 2`; root `yarn test` = `NODE_OPTIONS=--max-old-space-size=1024 turbo run test --concurrency=2`.
- Non-jest `test` scripts exist: `open-mercato-docs` (cleans + builds the Docusaurus site first), `create-mercato-app`
  (builds + node --test), `@open-mercato/eslint-plugin-ds` (node --test), `@open-mercato/starter` (echo).
- `apps/mercato/.env` already sets `OM_ENABLE_ENTERPRISE_MODULES=false` (and SSO/AGENTS/SECURITY false), so the
  dev server's normal build IS the OSS-only build; enterprise modules are pushed only behind that flag
  (`apps/mercato/src/modules.ts:197-230`).
- Generated registry: `apps/mercato/.mercato/generated/enabled-module-ids.generated.ts` / `modules.generated.ts`.
- Next build `distDir: '.mercato/next'` (`apps/mercato/next.config.ts:24`); the dev server compiles under the same root.

## Desired End State

`context/changes/delivery-os-oss-domain/handover/OSS-06-gate.md` lists every gate step with its exact result;
every failure inside `delivery_os` is fixed (and re-verified with a scoped command); out-of-ownership failures are
recorded as patch requests with exact output; the OSS-only registry check and `module-decoupling.test.ts` are
green; :3100 answers 200 on `/login` at the end.

### Key Discoveries:

- jest is already capped at 2 workers per package via `jest.config.base.cjs:39`.
- Enterprise flag default false in both `modules.ts` and `apps/mercato/.env`.

## What We're NOT Doing

- No fixes outside `packages/core/src/modules/delivery_os/{data,lib,commands,api,migrations}` + module root files.
- No edits to master plan / Progress, generated files, `turbo.json`, UI/QA/EXEC files.
- No Playwright integration run (QA-owned, not part of this task's gate list).
- No git writes (orchestrator commits).

## Implementation Approach

Decisions (self-answered, autonomous mode):
1. **Test step runner** — `NODE_OPTIONS=--max-old-space-size=1024 yarn turbo run test --concurrency=1 --filter='!open-mercato-docs'`
   (Recommended): jest stays at the base-config cap of 2 workers, one package at a time; the docs "test" is a full
   Docusaurus site build, not a unit suite, and is recorded as *not run* with the reason. Plus explicit targeted
   runs of the two named guard tests so their result is visible.
2. **build:app memory** — stop the shared dev server before `yarn build:app` (next build + next dev at once is the
   RAM-freeze risk, and both write under `.mercato/next`), then regenerate/restart it with its original command.
3. **"Enterprise on" restore** — the dev server's configured build is the `.env` one (enterprise off); restore means
   `yarn generate` + core build with the default `.env`, i.e. the configuration the dev server was started with.
4. **OSS-only assertion** — explicit env `OM_ENABLE_ENTERPRISE_MODULES=false` (+ sub-flags false) on `yarn generate`
   and core build, then grep the generated registry for `delivery_os` and for every enterprise module id
   (`record_locks`, `system_status_overlays`, `sso`, `security`, `agent_orchestrator`) and `@open-mercato/enterprise`.
5. **Fix scope** — delivery_os failures fixed in place; anything else becomes a patch request in OSS-06-gate.md.

## Phase 1: Run the capped gate and fix delivery_os failures

### Changes Required:

#### 1. Gate run (commands, in order, foreground, one at a time, timed with `/usr/bin/time -p`)

`yarn generate` (+ `git status --short` for generated diffs) → `yarn turbo run build --concurrency=2 --filter='./packages/*'`
→ `yarn i18n:check-sync` → `yarn i18n:check-usage` → `yarn turbo run typecheck --concurrency=2`
→ `yarn turbo run lint --concurrency=2 --filter=@open-mercato/core` → test step (decision 1) + targeted guard tests
→ stop dev server → `yarn build:app`.

#### 2. delivery_os fixes

**File**: `packages/core/src/modules/delivery_os/**` (owned subset only)
**Intent**: fix any type/lint/i18n/test failure attributed to delivery_os; re-run the scoped command.
**Contract**: no behaviour or contract change (feature freeze); `[internal]` prefix for internal error strings.
After any fix, re-run the affected scoped commands (core typecheck / core lint / delivery_os jest) and record them as re-runs
next to the original result, naming which tree each result describes (HEAD SHA + working-tree file list, since no git writes are allowed).

### Success Criteria:

#### Automated Verification:

- Every gate step executed once with exit code captured
- All delivery_os-attributed failures fixed and scoped re-run green
- `module-decoupling.test.ts` and `optimistic-lock-editable-entities.test.ts` green

## Phase 2: OSS-only reproduction, restore and gate record

### Changes Required:

#### 1. OSS-only reproduction

`OM_ENABLE_ENTERPRISE_MODULES=false … yarn generate` + `yarn turbo run build --concurrency=2 --filter=@open-mercato/core`,
registry grep (decision 4), import grep in `packages/core/src/modules/delivery_os` for `@open-mercato/enterprise` and `delivery-cezar`.

#### 2. Restore dev server

Default-env `yarn generate` + core build (already the configuration in `.env`), restart `OM_DEV_AUTO_OPEN=0 PORT=3100 yarn dev`
detached to `/tmp/omhack-dev.log`, confirm `/login` 200.

#### 3. Gate record

**File**: `context/changes/delivery-os-oss-domain/handover/OSS-06-gate.md`
**Intent**: table of every step: command, runner (local), duration, exit code, result, SHA; patch requests; not-run steps.

### Success Criteria:

#### Automated Verification:

- OSS-only registry contains `delivery_os` and no enterprise module id
- delivery_os import grep empty
- `curl http://localhost:3100/login` → 200
- OSS-06-gate.md lists every step

#### Manual Verification:

- Human accepts Progress 6.1/6.2 from the gate record

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Run the capped gate and fix delivery_os failures

#### Automated

- [x] 1.1 Every gate step executed once with exit code captured
- [x] 1.2 All delivery_os-attributed failures fixed and scoped re-run green
- [x] 1.3 module-decoupling.test.ts and optimistic-lock-editable-entities.test.ts green

### Phase 2: OSS-only reproduction, restore and gate record

#### Automated

- [x] 2.1 OSS-only registry contains delivery_os and no enterprise module id
- [x] 2.2 delivery_os import grep empty
- [x] 2.3 curl http://localhost:3100/login returns 200
- [x] 2.4 OSS-06-gate.md lists every step

#### Manual

- [ ] 2.5 Human accepts Progress 6.1/6.2 from the gate record
