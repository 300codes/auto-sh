# OSS-02 (L4f): minimal idempotent result acceptance — Plan Brief

> Full plan: `context/changes/asd-oss-t014-oss-02-l4f-add-minimal-idempotent-re/plan.md`
> Research: `context/changes/asd-oss-t014-oss-02-l4f-add-minimal-idempotent-re/research.md`

## What & Why

Agents (Cezar, the fake executor, a human running a package by hand) hand back a ResultManifest. The system, not the
agent, decides whether it counts: one command, `delivery_os.results.accept`, validates it in a frozen order and
records it exactly once. This is the visible "agent proposes, system decides" boundary of the demo.

## Starting Point

Reservation and the TaskPackage builder exist (T013). `lib/resultAcceptance.ts` has only `checkResultCorrelation`.
Nothing writes `DeliveryEvidence` yet.

## Desired End State

A valid manifest → one `result_manifest` evidence row, attempt `result_received`, task `awaiting_review`,
`completionDelivery='pending'` only when a workflow is linked, events emitted. Identical replay → `duplicate:true`,
no write, event re-emitted (so enterprise retries a pending delivery). Anything else → a catalogue error code.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Idempotency hash | hash of the parsed manifest, stored as `payloadHash` | tenant keys stripped; attempt DTO stays frozen | Plan |
| Conflict code | `409 result_conflict` | frozen catalogue | Research |
| Result gate | active states; cancel/unknown only after `completed` reconciliation | T008 decision | Task |
| Package for closed attempt | `attemptGate: 'none'` option | duplicate must beat `attempt_closed` | Plan |
| Kind check before correlation | `revision_kind_mismatch` first | published negative fixture | Research |
| Locks | task row only, no lock header | spec R16 | Research |
| Adapter source over HTTP | 403 `trusted_execution_required` | same boundary as T013 | Plan |

## Scope

**In scope:** pure evaluation, gate + reducer, command, unit tests, spec changelog, hand-over note.

**Out of scope:** route R16, allowedPaths / attachment / size checks (named seams), cancel/reconcile/mark_delivery,
attempt closing, unblock propagation.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Pure evaluation | `evaluateResultAcceptance`, `checkAttemptAcceptsResult`, `recordAttemptResult`, builder option | order of checks vs fixtures |
| 2. Command | `delivery_os.results.accept` + tests + docs | mocked EM cannot prove the DB unique index |

**Prerequisites:** T013 merged. **Estimated effort:** one session.

## Open Risks & Assumptions

- The real unique-index race is only simulated; QA TC-DELIVERY-006 covers it on a database.
- Descendants of a `blocked` task are not unblocked here.

## Success Criteria (Summary)

- delivery_os jest suite green with the listed cases on shipped fixtures; typecheck green; no update/delete of evidence.
