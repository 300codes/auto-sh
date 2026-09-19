# OSS-06 Final-Commit Regression Suite — Plan Brief

> Full plan: `context/changes/asd-oss-t036-add-the-final-commit-regression-suit/plan.md`

## What & Why

One jest file re-runs the five scenarios of master-plan row 6.2 (cross-tenant, stale approval, duplicate callback,
restart/unknown, OSS-only manual_handoff) through the real delivery_os route handlers, so the final commit has a single
re-runnable OSS evidence gate for 6.2 / 6.3.

## Starting Point

The scenarios are covered piecemeal across per-route and command-level tests; there is no one-file gate.

## Desired End State

`finalRegression.route.test.ts` with five named describes asserting status codes and row counts passes; the whole
delivery_os suite passes; the spec coverage table names it.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Helpers | New `api/__tests__/flowHelpers.ts`, used only by the new file | Existing tests keep their behaviour untouched |
| Decoupling assertion | Move pattern + file walker to `__tests__/enterpriseBoundary.ts`, imported by module-registration and the new suite | Reuse the exact assertion, one source |
| OSS-only module list | Require `apps/mercato/src/modules.ts` in `jest.isolateModules` with enterprise env unset | Asserts the real registration, not a copy |
| R1 cross-scope | Scope-honouring query engine mock in the test | Empty list asserted on the response, not call args |
| Executor counter | Test counter incremented only on a 201 reservation | HTTP cannot start the automatic executor; 201 is the only "run" |

## Scope

**In:** the test file, two test helpers, spec coverage row + changelog. **Out:** production code, Playwright, Progress ticks.

## Phases at a Glance

| Phase | Delivers | Key risk |
| --- | --- | --- |
| 1. Shared helpers | flowHelpers + enterpriseBoundary | breaking module-registration test |
| 2. Suite + spec | five describes, coverage row | manual attempts may emit `completionDelivery: null` not `pending` |

## Open Risks & Assumptions

- Requiring the app's `modules.ts` from core jest may fail to transform; fallback is a text assertion over the same file.
