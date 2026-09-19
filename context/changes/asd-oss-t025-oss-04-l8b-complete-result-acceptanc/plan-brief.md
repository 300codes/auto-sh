# OSS-04 (L8b): complete result acceptance checks — Plan Brief

> Full plan: `context/changes/asd-oss-t025-oss-04-l8b-complete-result-acceptanc/plan.md`
> Research: `context/changes/asd-oss-t025-oss-04-l8b-complete-result-acceptanc/research.md`

## What & Why

An agent's result manifest is a proposal. Today three of the acceptance rules are pass-through stubs, so a result
that touches files outside the task scope, invents test coverage or points at a tampered artifact would be accepted.
This change makes those rules real, for the manual import and the adapter path alike.

## Starting Point

`evaluateResultAcceptance` already runs schema → idempotency → attempt gate → correlation, then three stubs.
`isPathAllowed` and the baseline attachment verifier exist but are not used for results.

## Desired End State

A result is accepted only when its changed paths are inside `task.allowedPaths`, every check is bound to the frozen
AC/test maps and the profile, stored artifacts hash to their declared sha256 and belong to the caller's scope, and
the manifest is within size limits. Rejections persist nothing. An identical replay still answers `duplicate: true`.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Where artifacts are verified | In the command, after a pure `accept`, same transaction | Needs DB and storage; replay must stay I/O free | Research |
| Foreign artifact attachment | `422 foreign_reference`, detail `attachment_scope_mismatch` | Task text; existing code | Plan |
| Test catalogue | `requiredTests` ∪ baseline `declaredTests` ∪ profile `testCatalogue` | Whole-suite reports stay acceptable | Plan |
| False AC→test mapping | Rejected as `unknown_test_id` / `test_not_mapped_to_ac` | The model must not add coverage mappings | Plan |
| Check revision | Schema keeps `revision_mismatch`; helper also compares for R19 reuse | DTO v1 is frozen | Research |
| Runner `skipped` | `mapRunnerStatus` → `not_run` | Never counted as passed | Plan |
| Limits | 500 paths, 500 checks, 50 artifacts, 10 MiB / 64 MiB declared → 413 | Real bound below schema caps | Plan |
| Rule order | size → paths → checks → stored artifacts | Cheap bound first, hashes last (UA-12) | Plan |
| Fixture stage | New additive stage `acceptance` | Labelled stage in isolation | Plan |

## Scope

**In scope:** pure rules, check-mapping helper, generalised attachment verifier, command wiring, two negative
fixtures, unit/command/route tests, spec changelog, hand-over note.

**Out of scope:** schema or DTO changes, migrations, new error codes, routes, ACL, events, DI keys, test-evidence
import (R19), other streams' files.

## Architecture / Approach

Pure rules in `lib/` (`resultChecks.ts`, `resultAcceptance.ts`), I/O in `commands/` (`attachments.ts`,
`evidence.ts`). The command evaluates, then verifies stored artifacts only on `accept`, then writes evidence with the
verified `attachmentIds`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Pure rules, fixtures, lib tests | Paths, checks and size rules with fixtures | Rules stricter than what EXEC will report |
| 2. Command wiring, tests, docs | Artifact verification, "nothing persisted" proofs, hand-over | Test harness lacks attachment store |

**Prerequisites:** T024 committed (`47ca5acbf`).
**Estimated effort:** one session.

## Open Risks & Assumptions

- The EXEC adapter does not exist yet; rules follow the fake executor convention and are handed over as a contract.
- Artifacts without `attachmentId` cannot be byte-verified; their sha256 is recorded as declared.

## Success Criteria (Summary)

- Full `delivery_os` jest run green, including `manualFlow.route.test.ts`.
- Paired tests show accept versus reject for every rule, with nothing persisted on reject.
- Replay of an accepted manifest stays `duplicate: true` after `allowedPaths` narrowed.
