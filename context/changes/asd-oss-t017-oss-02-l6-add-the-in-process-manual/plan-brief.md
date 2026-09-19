# OSS-02 (L6) In-process Manual End-to-end Flow Test — Plan Brief

> Full plan: `context/changes/asd-oss-t017-oss-02-l6-add-the-in-process-manual/plan.md`

## What & Why

One jest suite drives the whole OSS-only manual path through the real route handlers and commands — project, draft,
manual baseline, requirements + design decisions, task, ready, reserve, package export, result import, project detail.
It is the repeatable proof of BN-01 and of the H10 gate: a legal export exists only after real human decisions.

## Starting Point

Routes R2–R16 each have their own tests, but every one seeds its preconditions (approved baseline, ready task), so no
test proves the chain or that decisions are the only way to an exportable package.

## Desired End State

`manualFlow.route.test.ts` passes inside the green delivery_os jest scope; it shows `activeBaselineId` flipping only after
the second decision, zero writes on package export, one evidence row after a replayed import, and three negative legs
(ready, reserve and export all impossible without both decisions).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Test layer | Real route handlers + registered commands on the existing in-memory route kit | Covers HTTP parsing, lock headers and command gates in one pass without a DB. |
| Shape | One happy-path `it` + separate negative `it`s sharing local step helpers | Steps depend on each other; forks stay readable. |
| Versions | Each call sends the version the previous response returned | Mirrors a real client and avoids reliance on seeded constants. |
| Attachment | Attachment rows placed in the kit store | In-process stand-in for the attachments module upload; byte hashing is OSS-03. |
| Session | Admin wildcard | Per-feature 403s are pinned by route-metadata tests already. |
| Enterprise guard | Reuse the existing registration test | It already scans every delivery_os file, including the new one. |

## Scope

**In scope:** new flow suite, root-cause fixes in OSS files if found, spec coverage row, hand-over addendum.

**Out of scope:** new kits, OSS-03/04 features, live-server run (done in T015/T016), H9 hand-over (next task).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Manual flow suite | Passing BN-01 suite with negative legs | Mock `em` lacks ORM hooks — versions must come from responses |
| 2. Spec and hand-over sync | Coverage row + addendum | None |

**Prerequisites:** T016 routes and kits in the working tree/branch.
**Estimated effort:** one session.

## Open Risks & Assumptions

- The flow may reveal a gap between route outputs and the next route's inputs (e.g. a version field); fixed in OSS files.

## Success Criteria (Summary)

- A reader sees BN-01 end to end in one test file with real decisions.
- The delivery_os jest scope stays green with `--maxWorkers=2`.
