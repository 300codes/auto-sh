# OSS-02 (L3a): DAG, task lifecycle, project status, traceability — Plan Brief

> Full plan: `context/changes/asd-oss-t007-oss-02-l3a-add-dag-task-lifecycle-pr/plan.md`

## What & Why

The deterministic half of "The Agent Proposes. The System Decides.": pure rules that decide whether a task graph is
valid, which task status changes are legal (including when `verified` is earned and when a correction loop must
escalate to a human), what the project status and honest AC progress are, and how requirements trace to evidence.

## Starting Point

v1 contracts, profiles, fixtures, entities and validators exist. `lib/dag.ts` has only a generic cycle finder. No
lifecycle, status or traceability logic yet; commands (L4) will call these rules.

## Desired End State

Four I/O-free modules (`dag`, `taskLifecycle`, `projectStatus`, `traceability`) with typed outputs mapped to the
error catalogue, and unit tests that pair every rejection with an accepted case.

## Key Decisions Made

| Decision | Choice | Why |
|---|---|---|
| Escalation after 2 correction rounds | New additive code `correction_limit_reached` (409) | Explicit, UI-distinguishable escalation; v1 allows additive codes |
| Correction count | Caller passes `{ started, max }`; missing → reject | Rule stays pure; fail closed |
| Status enum location | Move to `contracts.ts`, re-export from validators | lib must not import `shared`; public exports unchanged |
| `executing → cancelled` | Not allowed | Active attempt must be cancelled and reconciled first (plan) |
| Verified gate | Counting evidence on pinned baseline AND result revision AND no unproven AC | Master plan + spec UA-13 |
| Unblock of descendants | Back to `draft` | Ready gate must be re-checked; safe default |
| Progress | `{ proven, total, unit: 'ac', percent }`, `percent: null` when `total = 0` | Spec field names; no invented numbers |
| Project status | archived → draft → awaiting_approval → planning → in_progress → coverage_gap → released/verified | Derived only; release voided by a newer result revision |
| Traceability | Flat rows, unknown AC kept as row + issue, limit ≤ 1000 with `truncated` | Table-friendly, nothing silently dropped |

## Scope

**In scope:** four lib modules + tests, status enum move, one additive error code, spec update.

**Out of scope:** commands/routes, baseline readiness check (`baseline.ts`), per-check AC report (`deliveryReport.ts`).

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Contracts, DAG, lifecycle | graph validation, transition table and gates | table too strict for reconcile paths |
| 2. Status, traceability | project status/progress, traceability rows | status precedence surprising for UI |

**Prerequisites:** T004–T006 landed. **Estimated effort:** one session.

## Open Risks & Assumptions

- L4 commands must derive `correction.started` and `unprovenAcIds`; until `deliveryReport.ts` exists they compute
  proof from the accepted result manifest checks.
- UI needs the i18n key `delivery_os.errors.correction_limit_reached`.

## Success Criteria (Summary)

- `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2` green; core typecheck clean.
- No MikroORM/DI/enterprise/other-module import in the four modules.
