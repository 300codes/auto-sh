# Delivery Agents (hackathon) — enterprise execution: OSS boundary

> **Korekta kierunku — 2026-09-19:** [dodatek produktowy](../2026-09-19-delivery-project-flow-addendum.md) ma pierwszeństwo w zakresie domyślnego flow, osobnych akceptacji UX/KV/DS/UI, komentarzy Figma → Kanban, ustawień procesu i WordPress E2E jako głównego demo. [Nowe pakiety dla zespołu](../../../context/changes/autonomous-software-delivery/flow-handoff/README.md). Poniższy dokument zachowuje wcześniejsze ustalenia techniczne; dawne React-first/WP-PoC i estymaty nie stanowią odbioru ani wyceny rozszerzonego zakresu. To zmiana wymagań, nie potwierdzenie implementacji.

> Status: **Draft — boundary only** (OSS-01, T003). The OSS stream fixed the boundary. Execution sections are **Pending — to be completed by EXEC** (EXEC-02, EXEC-04).
> Master plan (source of truth for architecture, scope and acceptance): [`context/changes/autonomous-software-delivery/plan.md`](../../../context/changes/autonomous-software-delivery/plan.md). Execution workstream: [`workstreams/02-execution.md`](../../../context/changes/autonomous-software-delivery/workstreams/02-execution.md).
> OSS counterpart (data model, API, error codes): [`../2026-09-18-delivery-os-hackathon.md`](../2026-09-18-delivery-os-hackathon.md).

## TLDR

- Enterprise module `delivery_agents` (`packages/enterprise/src/modules/delivery_agents/`) runs a reserved `delivery_os` attempt automatically. It uses an existing workflow, the platform queue and the Cezar CLI adapter (`packages/delivery-cezar/`).
- It **consumes** only the public OSS surface: commands through the command bus, events, the DI read service `deliveryOsAttemptQueries`, the injection spot `delivery_os.project.execution` and the v1 DTOs. OSS **never** imports enterprise.
- `mode: 'automatic'` exists only through the trusted in-process command context. The public OSS API accepts only `manual_handoff`.
- Without enterprise, the OSS manual flow (export package → run the agent by hand → import the result) stays complete.

## Overview

The master plan splits delivery into an OSS domain (`delivery_os`, the record of truth) and an enterprise execution layer (`delivery_agents`, the automation). This spec pins down the **contract between them**, so the EXEC stream can build against fixtures from the OSS H4 hand-over. Rationale lives in the master plan, Phase 2 (*Aktywacja*) and Phase 4 (*Protokół wykonania i odzyskania*). Design of the execution internals belongs to EXEC.

## Problem Statement

Automatic execution needs to reserve, claim, deliver and recover attempts that the OSS module owns. If enterprise wrote OSS tables directly, or if OSS called enterprise, the OSS-only edition would break. An agent could also bypass the human gates. The boundary must be narrow, typed and one-directional.

## Proposed Solution

### What enterprise consumes from OSS

| Surface | Id / name | Use by enterprise |
|---|---|---|
| Command | `delivery_os.attempts.reserve` | Reserve with `mode: 'automatic'`, `Idempotency-Key` and `baseRevision`. The command accepts `automatic` **only** when it runs in-process without `ctx.request` and with the typed option `trustedExecution: { source: 'delivery_agents', actorUserId }` (trusted internal context). The same idempotency and lock rules apply as for the public route R14. |
| Command (internal) | `delivery_os.attempts.claim` | Conditional claim. It sets `claimedAt` and `workerRef` exactly once. A second claim is refused, so a repeated enqueue is safe. |
| Command (internal) | `delivery_os.attempts.link_workflow` | Stores `workflowRef`, `workflowStepId` and `dispatchedAt` on the attempt. |
| Command (internal) | `delivery_os.results.accept` | The worker delivers a `ResultManifest v1` with `source: 'adapter'`. It uses the same validation as the public `POST /tasks/:id/results`. In one transaction it writes the evidence, `resultEvidenceId` and, when the attempt has a `workflowRef`, `completionDelivery = 'pending'`. |
| Command (internal) | `delivery_os.attempts.mark_delivery` | Records `delivered` or `lastDeliveryError` after the workflow signal. It is serialized per attempt under the task row lock. |
| Commands (public) | `delivery_os.attempts.cancel`, `delivery_os.attempts.reconcile` | These are the same operations as the OSS routes R17/R18. An injected widget calls them through the OSS API, never directly. |
| Event | `delivery_os.evidence.recorded` | Triggers delivery of a pending result. It is re-emitted on a duplicate import, so a pending delivery is retried. |
| Event | `delivery_os.task.updated`, `delivery_os.baseline.approved`, `delivery_os.project.created` | Projection and UI refresh only. |
| DI service | `deliveryOsAttemptQueries` | `getAttempt`, `buildTaskPackage` (the same builder as `GET /tasks/:id/package`, no writes) and `listPendingDeliveries` (recovery after a restart). Scope `{tenantId, organizationId}` is always required. |
| Injection spot | `delivery_os.project.execution`, context `delivery_os.project.execution.v1` | The enterprise widget renders execution actions on the OSS project detail page. It uses `retryLastMutation` and `refresh`. |
| DTOs | `@open-mercato/core/modules/delivery_os/lib/contracts` | `TaskPackage v1`, `ResultManifest v1`, `SourceRevision`, `ExecutionAttempt v1`, `ExecutionWidgetContext v1`, `DELIVERY_CONTRACT_VERSION`. |
| ACL | `delivery_os.attempts.manage`, `delivery_os.results.import` | Enterprise features may require these OSS features in addition to its own. The worker re-checks the actor's current permissions and the attempt state before any effect. |

### Rules

1. **OSS never imports enterprise.** `packages/core/src/modules/delivery_os/**` has no import of `@open-mercato/enterprise/**` or `@open-mercato/delivery-cezar`. There is no `container.resolve` of an enterprise key, and no widget from enterprise is referenced by id in OSS code. This is enforced by `packages/core/src/__tests__/module-decoupling.test.ts` and a grep in the OSS-06 gate.
2. **Enterprise writes OSS state only through OSS commands.** It never writes `delivery_*` tables directly, and it defines no ORM relation to OSS entities (it uses ids only).
3. **The public API never grants `automatic`.** The route validator is `z.literal('manual_handoff')`. Enterprise does not expose any field that turns into `automatic` from a request body.
4. **Scope comes from the backend.** The execution context stores the tenant, organization and actor resolved by the backend. A tenant or organization value inside a manifest is ignored.
5. **No public callback.** Results come back through the internal `delivery_os.results.accept` command (worker) or the authenticated OSS import (manual). No HTTP endpoint accepts results from the CLI host.
6. **OSS-only degrades cleanly.** Without `delivery_agents`, `workflowRef` stays empty, `completionDelivery` stays `null`, `mark_delivery` and `listPendingDeliveries` are no-ops, and the UI shows no automation.

## Architecture

```
delivery_agents (enterprise)  ──command bus / DI / events / spot──▶  delivery_os (OSS)
        │                                                                 ▲
        ▼                                                                 │ (never)
 workflows engine, queue `delivery-execute`, @open-mercato/delivery-cezar ┘
```

Module files from the master plan (owned by EXEC): `packages/enterprise/src/modules/delivery_agents/{index,acl,setup,di}.ts`, `widgets/`, `lib/{executionBridge,resultAcceptance,attemptWorkflow,manualHandoff}.ts`, `commands/executions.ts`, `workers/{execute-task,resume-attempt}.ts`, `api/tasks/[id]/execute/route.ts`. The Cezar adapter lives in `packages/delivery-cezar/{package.json,src/index.ts,src/runner.ts,src/resultManifest.ts}`.

### Execution protocol

**Pending — to be completed by EXEC.** The master plan Phase 4 fixes the constraints: one workflow instance per attempt, a `WAIT_FOR_SIGNAL` step, and enqueue only after the parked step is confirmed. Retry never re-spawns the CLI.

### Workflow definition

**Pending — to be completed by EXEC.** The master plan requires `workflowDefinitionAuthoring.upsertOwnedDefinition` with owner `delivery_agents`, a stable owner id and explicit grants. It forbids new activity types and changes to the workflows engine.

### Worker and queue

**Pending — to be completed by EXEC.** The master plan fixes queue `delivery-execute` with `concurrency: 2` (`yarn mercato queue worker delivery-execute --concurrency=2`), a separate resume worker, and no change to global defaults.

### Cezar adapter

**Pending — to be completed by EXEC.** The adapter produces `ResultManifest v1` following the OSS contract. The AC-id convention from OSS-01 (T002) applies: `checks[].testId` is the Vitest `fullName`, `acIds[]` is parsed from the `AC-NNN:` title prefix, and `rawReportHash` is the SHA-256 of the raw `reports/vitest-report.json`.

### Recovery

**Pending — to be completed by EXEC.** The OSS side provides the durable `completionDelivery = 'pending'` state, `listPendingDeliveries(scope)`, the re-emitted `delivery_os.evidence.recorded` event and the `reconcile` operation. An uncertain start (after claim, before spawn) needs reconciliation, never an automatic re-run.

## Data Models

Enterprise adds no columns to OSS tables. Execution fields live in the OSS `ExecutionAttempt v1` JSON: `workerRef`, `externalRunId`, `workflowRef`, `workflowStepId`, `dispatchedAt`, `resultEvidenceId`, `completionDelivery`, `lastDeliveryError`. They are written only through the commands listed above. See the OSS spec, `delivery_tasks.execution_attempts`.

Enterprise-owned tables, if any: **Pending — to be completed by EXEC.**

## API Contracts

| Method | Path | Feature | Notes |
|---|---|---|---|
| POST | `/api/delivery_agents/tasks/:id/execute` | enterprise feature (EXEC defines it) + `delivery_os.attempts.manage` | From the master plan. It authorizes, reserves (`automatic`, internal context), links the workflow and enqueues. Request, response and error codes: **Pending — to be completed by EXEC**. Error bodies should reuse the OSS shape `{error, code, details[]}` and the OSS codes where they overlap (for example `attempt_active`, `task_not_ready`, `idempotency_conflict`). |

No other enterprise HTTP route is planned. In particular, there is no public result callback.

## Integration Coverage

QA owns `packages/enterprise/src/modules/delivery_agents/__integration__/TC-DELIVERY-EXEC-NNN.spec.ts`. Proposed ids (scenarios fixed by the master plan's integration coverage):

| Spec | Path / flow | Asserts |
|---|---|---|
| TC-DELIVERY-EXEC-001 | `POST /api/delivery_agents/tasks/:id/execute` | authorization and scope, one attempt per key, `automatic` is not reachable through the OSS API, the workflow step is parked (`WAIT_FOR_SIGNAL`) before enqueue |
| TC-DELIVERY-EXEC-002 | worker → `delivery_os.results.accept` → workflow resume | manifest tenant ignored, evidence and pending written atomically, correct workflow step resumed |
| TC-DELIVERY-EXEC-003 | duplicate result / lost delivery / restart | duplicate does not duplicate evidence but retries delivery, recovery scans pending, an uncertain start requires reconcile |
| TC-DELIVERY-EXEC-004 | OSS-only vs enterprise registry | both variants build, and the OSS manual flow works with enterprise disabled |
| TC-DELIVERY-EXEC-005 | pause/cancel in the workflow + execution projection | no new dispatch, late result rejected, `stop_unconfirmed` shown until a real stop is confirmed |

Exact test list: **Pending — to be completed by EXEC/QA.**

## Migration & Backward Compatibility

- Additive only: a new enterprise module and (from EXEC-02) a new workspace package `@open-mercato/delivery-cezar`. No existing contract surface changes.
- Activation: `delivery_agents` is registered in `apps/mercato/src/modules.ts` under the same flags as `agent_orchestrator` (`OM_ENABLE_ENTERPRISE_MODULES` and `OM_ENABLE_ENTERPRISE_MODULES_AGENTS`, `apps/mercato/src/modules.ts:196-221`). It is not added to the create-app template.
- It depends on the frozen OSS v1 surface (command ids, event ids, DI key, spot id and context contract, DTO `schemaVersion` strings). A breaking need on either side becomes v2 and is announced to all streams.
- Rollback: disable the flag. OSS data and the manual flow stay intact.

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| Enterprise path bypasses human gates or tests | High | safety | same `results.accept` validation as manual import; no decision commands used by the worker | — |
| `automatic` injected through the public API | High | safety | literal validator on the route; command checks the absence of `ctx.request` | EXEC must call in-process |
| Lost signal between evidence and workflow resume | High | recovery | durable `pending`, `listPendingDeliveries`, re-emitted event, retry of delivery only | Pending EXEC design |
| OSS gains an enterprise import | Medium | licensing / OSS-only | decoupling test and a grep in the gate | — |
| Execution internals not yet specified | Medium | schedule | sections marked Pending; EXEC completes them in EXEC-02/04 | open |

## Final Compliance Report

| Rule | Status |
|---|---|
| Enterprise scope only in `.ai/specs/enterprise/` | Yes |
| OSS does not import enterprise | Designed; enforced by the decoupling test |
| No direct ORM relations across modules | Designed (ids only; writes through OSS commands) |
| Tenant/org scope from backend, not from manifests | Designed |
| Integration coverage for every enterprise API path | Placeholder ids listed; EXEC/QA complete |
| Execution design | **Pending — to be completed by EXEC** |

## Changelog

- 2026-09-19 — Boundary-only draft (OSS-01, T003): consumed OSS commands/events/DI/spot/DTOs, one-directional rule, `automatic` only through the trusted internal context, planned enterprise route, TC-DELIVERY-EXEC placeholders, Migration & BC. Execution sections left pending for EXEC.
