# OSS-02 (H9) OSS-only Gate, Live Smoke and Hand-over — Plan Brief

> Full plan: `context/changes/asd-oss-t018-oss-02-h9-reproduce-oss-only-run-the/plan.md`

## What & Why

Close OSS-02 with evidence: rebuild the registries with enterprise off, run the capped gate once, smoke the manual
flow live and write the H9 hand-over that other streams and the human acceptor read (UA-29, BN-01/14/16).

## Starting Point

`delivery_os` has R1–R16, commands, ACL, events, the DI query service and the execution spot; unit + in-process flow
tests are green (30 suites / 685 tests at T017). The dev server on :3100 already runs with enterprise modules off.

## Desired End State

`OSS-02-H9.md` lists exact commands, exit codes and counts, a live transcript (reserve 201/200, non-mutating package GET,
import 201/200, cross-scope 404), NOT RUN items, limitations, Progress-row evidence and patch requests; git status shows
only OSS-owned changes.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Cross-scope probe | SQL-inserted foreign-org project row + random UUID, both must answer 404 | Only one org is seeded; a real foreign row proves filtering, not absence. |
| Smoke vehicle | `/tmp/t018/live.ts`, transcript quoted | Repeatable without shipping throwaway code. |
| Gate scope | core build/typecheck/eslint/jest + generate + i18n advisory | Recorded decision: full-repo gate deferred to OSS-06 (16 GB RAM rule). |
| Template sync / lock test | Run check, report as patch request | Files are not OSS-owned. |
| 2.3 enterprise half | NOT RUN, EXEC scope | OSS never imports enterprise. |

## Scope

**In scope:** gate run, generated registry read, live smoke + cleanup, hand-over note, OSS-owned defect fixes.

**Out of scope:** R17–R22, new codes, generated/foreign file edits, full-repo gate, ticking Progress.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Capped gate | Exit codes and counts, registry check | Memory guard kills a heavy command → rerun narrower |
| 2. Live smoke | Transcript + cleanup | Dev server stale after build → restart once |
| 3. Hand-over | `OSS-02-H9.md`, ownership check | None significant |

**Prerequisites:** dev server on :3100, docker stack `omhack`.
**Estimated effort:** one session.

## Open Risks & Assumptions

- The core build rewrites `dist` used by the running dev server; a restart may be needed.
- Two-connection races remain QA's (TC-DELIVERY-006).

## Success Criteria (Summary)

- Gate green or each failure listed with cause.
- Live transcript shows the required statuses and a 404 cross-scope probe.
- Hand-over complete; no foreign file modified.
