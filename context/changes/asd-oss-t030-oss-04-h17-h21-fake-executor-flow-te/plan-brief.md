# OSS-04 H17/H21 fake-executor flow, QA scenarios and hand-over — Plan Brief

> Full plan: `context/changes/asd-oss-t030-oss-04-h17-h21-fake-executor-flow-te/plan.md`

## What & Why
This closes OSS-04 with proof that the execution bridge runs the agent CLI exactly once. That holds across a replay,
a failed completion delivery, a foreign baseline and a restart with an unknown process. QA, EXEC and UI get one hand-over to build on.

## Starting Point
All OSS-04 commands and routes exist (L8a–L8f). The tests cover them one at a time. There is no single end-to-end
fake-executor flow that starts from a ready task, and no written H21 hand-over.

## Desired End State
`executorFlow.test.ts` covers the main flow and QA scenarios (a), (b), (c), plus a test that one revision's evidence
does not count for another revision. `OSS-04-H21.md` has the recipes, the patch requests, the test output and a live smoke transcript.

## Key Decisions Made
| Decision | Choice | Why |
|---|---|---|
| Test level | Command-level jest with an in-memory store (same as results.test.ts) | Deterministic, fast, no shared DB; real-DB concurrency is QA |
| Fake executor | `jest.fn` → `buildTaskPackage` + `buildResultManifest` | Uses the real package the CLI would get; a counter proves it runs once |
| Recovery scan | `listPendingDeliveries` + `getAttempt` | The only scan OSS offers; it never lists runnable work |
| Scenario (b) | v1 manifest posted to a v2-pinned attempt → 422 baseline_mismatch; acProof(v2) missing | Shows "no credit to the new baseline" in data, not only by status code |
| Production code | none | Contracts are frozen; this is evidence + hand-over |

## Scope
**In:** one test file, hand-over, live smoke. **Out:** production code, master plan, UI/QA/EXEC files.

## Phases at a Glance
| Phase | Delivers | Risk |
|---|---|---|
| 1. Tests | executorFlow.test.ts green, delivery_os suite green | harness drift vs results.test.ts |
| 2. Smoke + hand-over | live transcript, OSS-04-H21.md | dev server restart/compile time |

## Open Risks & Assumptions
- The EXEC bridge follows the documented call order; the hand-over states it as a patch request.
