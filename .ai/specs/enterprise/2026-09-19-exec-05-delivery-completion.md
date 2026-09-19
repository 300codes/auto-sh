# EXEC-05: Delivery completion — i18n, QA coverage, Faza 2 live execution

**Status:** Draft — 2026-09-19  
**Refs:** EXEC-04 (`2026-09-19-exec-04-execute-api-and-workflow.md`), OSS-04 (merged)

---

## Problem

OSS-04 landed on main, unblocking EXEC-04 Faza 2. Before the live executor can be enabled three categories of debt must be cleared:

1. **i18n gaps** — two audit-stage translation keys missing from `delivery_os` are causing `yarn i18n:check-usage` to exit 1 on main; the `delivery_agents` widget carries hardcoded English strings that will become a blocker when the Phase 2 i18n policy tightens.
2. **QA coverage gaps** — TC-DELIVERY-002/004/006/007/008 (HTTP-layer) and TC-DELIVERY-EXEC-006 (concurrent reservation) were never written; without them the OSS-04 state machine has no automated regression net.
3. **Faza 2 not enabled** — `CezarTaskExecutor` is wired in DI but the env flag is unset, no E2E vertical run has been executed, and the 10-minute reconciliation cron is not implemented.

---

## Scope

| # | Item | Owner | Urgency |
|---|------|-------|---------|
| 1 | Add `delivery_os.audit.stages.*` i18n keys to all locale files | Adam | Blocking main |
| 2 | Create `delivery_agents/i18n/` with widget translations | Marcin | Pre-Faza 2 |
| 3 | Write TC-DELIVERY-002/004/006/007/008 specs (HTTP-layer) | Michał | QA gap |
| 4 | Write TC-DELIVERY-EXEC-006 concurrent-reservation spec | Michał | QA gap |
| 5 | Faza 2 Step 10 — enable `CezarTaskExecutor` in staging | Marcin | Faza 2 |
| 6 | Faza 2 Step 11 — E2E vertical run (2 concurrent flows) | Marcin | Faza 2 |
| 7 | Faza 2 Step 12 — reconciliation cron + pending-delivery monitor | Marcin | Faza 2 |

Out of scope: OSS-04 implementation (already merged), UI-03 (merged), EXEC-04 Faza 1 (done).

---

## Phase 1 — i18n fixes (Adam + Marcin)

### 1.1 `delivery_os` audit stage keys (Adam) — BLOCKING MAIN

**Why it fails:** `packages/core/src/modules/delivery_os/commands/stages.ts` calls `resolveTranslations().translate('delivery_os.audit.stages.create_artifact', fallback)` (line 385) and `'delivery_os.audit.stages.decide'` (line 599). Both keys are absent from all locale files. `yarn i18n:check-usage` exits 1.

**Files to touch:**

```
packages/core/src/modules/delivery_os/i18n/
  en.json   ← add 2 keys
  de.json   ← mirror (English value until translator supplies German)
  es.json   ← mirror
  ko.json   ← mirror
  pl.json   ← mirror
```

**Keys to add (insert alphabetically within `delivery_os.audit.stages.*` namespace):**

```json
"delivery_os.audit.stages.create_artifact": "Record delivery stage artifact",
"delivery_os.audit.stages.decide": "Decide delivery stage"
```

**Verification:** `yarn i18n:check-usage` exits 0; `yarn i18n:check-values` exits 0 or emits only known non-English warnings.

---

### 1.2 `delivery_agents` widget i18n (Marcin)

**Current state:** `widget.client.tsx` contains 6 hardcoded English strings that will fail the Phase 2 hardcoded-scanner gate:

| Line | String |
|------|--------|
| 43 | `flash('Execution started', 'success')` |
| 48 | `flash('Execution started', 'success')` |
| 64 | `flash('Cancellation requested', 'success')` |
| 68 | `flash('Cancellation requested', 'success')` |
| 94 | `aria-label="Execute delivery task via Cezar"` |
| 96 | `{busy ? 'Starting…' : 'Execute'}` |
| 106 | `aria-label="Cancel execution attempt"` |
| 108 | `{isCancelPending ? 'Cancelling…' : 'Cancel'}` |

**Files to create/touch:**

```
packages/enterprise/src/modules/delivery_agents/i18n/
  en.json   ← create new, all 8 keys below
```

**Keys:**

```json
{
  "delivery_agents.widget.execute.label": "Execute",
  "delivery_agents.widget.execute.ariaLabel": "Execute delivery task via Cezar",
  "delivery_agents.widget.execute.starting": "Starting…",
  "delivery_agents.widget.execute.started": "Execution started",
  "delivery_agents.widget.execute.failed": "Execution failed",
  "delivery_agents.widget.cancel.label": "Cancel",
  "delivery_agents.widget.cancel.ariaLabel": "Cancel execution attempt",
  "delivery_agents.widget.cancel.cancelling": "Cancelling…",
  "delivery_agents.widget.cancel.requested": "Cancellation requested",
  "delivery_agents.widget.cancel.failed": "Cancel failed"
}
```

`widget.client.tsx`: add `const { t } = useT('delivery_agents')` and replace hardcoded strings with `t('delivery_agents.widget.*')` lookups. Internal error flashes (`[internal] Execution failed`, `[internal] Cancel failed`) are already prefixed with `[internal]` — leave them as-is (opted out of i18n checker per convention).

No locale files beyond `en.json` are required until a translator supplies them; the fallback chain in `resolveTranslations()` will serve English to all locales until then.

---

## Phase 2 — QA coverage (Michał)

All specs below follow the fixture pattern from `TC-DELIVERY-OSS-001.spec.ts` (HTTP-only, `apiRequest` helper, `beforeAll`/`afterAll` fixture lifecycle, `finally` cleanup). No Playwright browser sessions — these are pure API specs.

### 2.1 TC-DELIVERY-002 — Baseline input modes

**Target file:** `packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-002.spec.ts`

**Cases:**
- `FROM_BRIEF` and `FROM_DESIGN` produce semantically equivalent baseline schemas when given matching inputs.
- Missing acceptance criteria returns 422 with a field error identifying `acceptanceCriteria`.
- Attachment scope and SHA-256 hash are persisted and returned on GET.
- Submitting identical content (same hash, same AC IDs) does not create a second baseline row — it returns the existing `baselineId`.
- Schema version `"unknown"` or a `projectId` belonging to a different tenant returns 400/404 respectively.
- An approved baseline is immutable: subsequent PUT/PATCH returns 409.

### 2.2 TC-DELIVERY-004 — Task plan validation and import

**Target file:** `packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-004.spec.ts`

**Cases:**
- A task graph with a cycle returns 422 identifying the cycle edge.
- A `projectId` belonging to a different tenant returns 404.
- An unknown AC ID in the task's `acIds` returns 422.
- Optimistic lock header mismatch on task update returns 409.
- `readyGate` enforcement: `READY` transition rejected when required predecessor tasks are not `DONE`.
- `verifiedOnly` constraint: task cannot move to `VERIFIED` unless all linked evidence rows are `approved`.
- Plan import: unknown `allowedPaths` entry returns 422; AC→test mapping referencing missing test IDs returns 422.
- Re-import of a plan with unchanged task IDs produces no duplicate rows.

### 2.3 TC-DELIVERY-006 — Evidence recording edge cases

**Target file:** `packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-006.spec.ts`

**Cases:**
- Duplicate result with the same content hash and `attemptId`: the command is idempotent — returns the existing evidence row ID (no new row), re-emits `delivery_os.evidence.recorded`.
- Different hash for the same `attemptId` and AC returns 409 (hash conflict).
- Unknown `baselineId` or `commitRef` returns 422.
- Submitting evidence for a cancelled attempt returns 409.
- Foreign-tenant attempt ID returns 404.
- Body exceeding the configured size limit returns 413.
- `tenant_id` field in the manifest body is silently ignored (scoping comes from auth context).

### 2.4 TC-DELIVERY-007 — Cancel and reconcile ACL + state transitions

**Target file:** `packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-007.spec.ts`

**Cases:**
- `/attempts/:id/cancel` requires `delivery_os.attempts.manage`; user without it gets 403.
- `/attempts/:id/reconcile` requires `delivery_os.attempts.reconcile`; user without it gets 403.
- Submitting a result after cancel returns 409 (`attempt_closed`).
- Reconciling with an unknown `resolution` value returns 422.
- An attempt in `completed` state cannot transition to `verified` directly (must go through `reconcile`).

### 2.5 TC-DELIVERY-008 — Evidence discriminator and review gate

**Target file:** `packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-008.spec.ts`

**Cases:**
- Evidence `discriminator` must be one of the declared enum values; unknown value returns 422.
- Revision field and AC mapping are required for `screenshot` and `scan` discriminator types.
- Tampered/false SHA-256 hash (content does not match declared hash) returns 422 on accept.
- Review `approved` verdict sets task `verified` only when the proof chain (evidence rows → AC coverage) is complete; partial coverage keeps the task in `reviewing`.
- `changes_requested` round limit (configured per tenant): exceeding it returns 422 with `REVIEW_ROUND_LIMIT_EXCEEDED`.
- Deploy route refuses a non-green evidence report (any `changes_requested` or `pending` row blocks it).

### 2.6 TC-DELIVERY-EXEC-006 — Concurrent reservation

**Target file:** `packages/enterprise/src/modules/delivery_agents/__integration__/TC-DELIVERY-EXEC-006.spec.ts`

**Prerequisite:** Live `delivery_os.attempts.reserve` implementation from OSS-04 (already merged — run against the real test DB, no fake executor).

**Cases:**
- Two simultaneous `POST /api/delivery_agents/tasks/:id/execute` requests for the same task, sent via `Promise.all` with two independent auth sessions:
  - Exactly one returns 202 with `{ attemptId }`.
  - The other returns 409 with `{ code: "ALREADY_EXECUTING" }` (or equivalent serialized conflict from the reserve command).
- After the winning call, `GET /api/delivery_os/attempts?taskId=:id` returns exactly one attempt in `reserved` state.
- A second pair of concurrent calls after the first attempt is `cancelled` must again produce one winner and one conflict.

---

## Phase 3 — Faza 2 live execution (Marcin)

### 3.1 Step 10 — Enable `CezarTaskExecutor`

**DI selector is already in place** (`packages/enterprise/src/modules/delivery_agents/di.ts`). Activation is environment-level only:

```bash
DELIVERY_EXECUTOR=cezar yarn mercato queue worker delivery-execute --concurrency=2
```

On staging: set `DELIVERY_EXECUTOR=cezar` in the deployment env and restart the queue worker process. Verify that `CezarTaskExecutor.startExecution()` is called (check worker logs for the `cezar` adapter handshake).

**Smoke test:** submit one real baseline through the UI → POST execute → observe `reserved` → `executing` transition in the attempt table.

### 3.2 Step 11 — E2E vertical run

Execute two concurrent delivery flows end-to-end using real baselines (produced through the UI-03 flow):

1. Flow A: `FROM_BRIEF` baseline → execute → poll until `completionDelivery` transitions → accept result → verify task → deploy gate.
2. Flow B: `FROM_DESIGN` baseline → execute → cancel mid-flight → reconcile → re-execute.
3. Run both flows concurrently (two terminal sessions) to exercise the OSS-04 state machine under load.

**Pass criteria:**
- Both flows complete without uncaught 5xx.
- No `completionDelivery='pending'` rows remain after reconciliation.
- `TC-DELIVERY-EXEC-006` (concurrent reservation) passes against the live DB.

### 3.3 Step 12 — Reconciliation cron + monitoring

**New file:** `packages/enterprise/src/modules/delivery_agents/workers/pending-delivery-scan.ts`

**Behaviour:**
- Runs every 10 minutes (cron expression `*/10 * * * *`).
- Queries `delivery_os_attempts` for rows where `completion_delivery = 'pending'` and `updated_at < now() - interval '15 minutes'` (grace period to avoid racing with in-flight workers).
- For each stale row: re-enqueues a `delivery-resume` job with the stored `workflowRef`, marking it for retry.
- Logs `[delivery_agents:reconcile]` at `info` level with the count of re-enqueued rows per tenant.
- Is idempotent: if the workflow has already resumed, the re-enqueue is a no-op (idempotency key on the job).

**Monitor dashboard entry:** Add a KPI widget to the delivery_agents admin page showing the count of `completion_delivery='pending'` attempts older than 15 minutes, refreshing every 60 seconds via `useOperationProgress`.

---

## Implementation breakdown

| Phase | Steps | Owner | Estimated |
|-------|-------|-------|-----------|
| Phase 1 — i18n | 1.1 (2 keys, 5 files) + 1.2 (10 keys, 1 file + widget refactor) | Adam + Marcin | H1 |
| Phase 2 — QA | 5 HTTP specs + 1 concurrent spec | Michał | H2–H4 |
| Phase 3.1 — executor swap | env flag + smoke test | Marcin | H1 (after i18n) |
| Phase 3.2 — E2E run | manual + automated concurrent test | Marcin + Michał | H2 |
| Phase 3.3 — cron + monitor | 1 worker file + 1 KPI widget | Marcin | H2 |

---

## Backward compatibility

No contract surfaces are changed: no new API routes, no schema changes, no event ID changes. New i18n keys are additive. The `DELIVERY_EXECUTOR` env switch is backwards-compatible (defaults to `fake` when unset, preserving the EXEC-04 Faza 1 test behaviour).

---

## Open questions

None — all design decisions are inherited from OSS-04 (merged) and EXEC-04 Faza 1 (done). The implementation follows established patterns in both modules.

## Resolved assumptions (autonomous defaults)

| # | Assumption | Default applied | Confidence |
|---|-----------|----------------|------------|
| 1 | OSS-04 is fully merged and all commands are available in production | Confirmed from git log (commits `47ca5acbf`–`124828233` on main) | High |
| 2 | `CezarTaskExecutor` env var name stays `DELIVERY_EXECUTOR=cezar` | Inherited from EXEC-04 DI wiring, no change | High |
| 3 | Reconciliation grace period is 15 minutes | Matches typical queue worker heartbeat interval; adjust per Mateusz's recommendation if OSS-04 state machine has a different expected SLA | Medium |
| 4 | i18n Phase 2 policy is not yet enforced (exit 0 with warnings) | Confirmed: `yarn i18n:check-hardcoded` is advisory in Phase 1 per `.ai/specs/2026-05-26-missing-translations-audit-and-remediation.md` | High |

---

## Progress

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1.1 — delivery_os i18n (2 keys × 5 locales) | Done | 2026-09-19 | yarn i18n:check-usage exits 0 |
| Phase 1.2 — delivery_agents widget i18n | Done | 2026-09-19 | en.json created, widget refactored to useT() |
| Phase 2 — QA (6 specs) | Done | 2026-09-19 | TC-DELIVERY-002/004/006/007/008 + EXEC-006 written |
| Phase 3.1 — executor swap | Not Started | — | Env-only: DELIVERY_EXECUTOR=cezar; pending staging deploy |
| Phase 3.2 — E2E vertical run | Not Started | — | After Phase 3.1 |
| Phase 3.3 — cron worker | Done (pre-existing) | — | pending-delivery-scan.ts already implemented |

### Phase 1 — Detailed Progress
- [x] Step 1.1: Add `delivery_os.audit.stages.create_artifact` + `delivery_os.audit.stages.decide` to en/de/es/ko/pl.json
- [x] Step 1.2: Create `packages/enterprise/src/modules/delivery_agents/i18n/en.json` (10 keys)
- [x] Step 1.2: Refactor `widget.client.tsx` — add `useT('delivery_agents')`, replace 6 hardcoded strings

### Phase 2 — Detailed Progress
- [x] TC-DELIVERY-002: Baseline input modes (7 cases)
- [x] TC-DELIVERY-004: Task plan validation and import (9 cases)
- [x] TC-DELIVERY-006: Evidence recording edge cases (6 cases)
- [x] TC-DELIVERY-007: Cancel and reconcile ACL + state transitions (5 cases)
- [x] TC-DELIVERY-008: Evidence discriminator and review gate (6 cases)
- [x] TC-DELIVERY-EXEC-006: Concurrent reservation (3 cases)
