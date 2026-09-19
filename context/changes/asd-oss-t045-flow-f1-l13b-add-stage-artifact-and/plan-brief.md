# FLOW-F1 L13b — Stage Artifact and Stage Decision Commands — Plan Brief

> Full plan: `context/changes/asd-oss-t045-flow-f1-l13b-add-stage-artifact-and/plan.md`

## What & Why

Scope/UX/Key Visual/DS-UI need versioned artifacts and separate, dependent approvals so the backend can refuse a
transition without the right consent (FLOW-02/09). The pure rules (T042/T043) and tables (T041) exist; this task adds
the two commands with locks, replay, the attempt guard, attachment verification, approver features and audit.

## Starting Point

`lib/stageArtifacts.ts` and `lib/stageDecisions.ts` decide every outcome; `commands/flow.ts` / `intake.ts` show the
probe → lock → plan → persist → emit shape; `checkProjectArchivable` already detects active/unknown attempts.

## Desired End State

`delivery_os.stages.create_artifact` and `delivery_os.stages.decide` registered and unit-tested; both stage events
emitted; every delivery_os suite green; spec changelog and hand-over written.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Replay before lock | Probe on a forked em, re-plan under the row lock | One code path; a duplicate never needs a lock header (spec F7/F8 "required (after replay)") |
| Attempt guard | Reuse `checkProjectArchivable(tasks, 'stage')` (additive subject) | Same active/unknown reducer as v1, only the message changes |
| Approver features | `rbacService.getGrantedFeatures` (wildcards intact), fail closed to `[]` | `checkStageApprover` needs the grant list; an RBAC failure must not approve |
| Thread seam | `loadStageCommentThreads` → `[]`, `recordThreadDeferrals` no-op, both exported | L17 plugs the query and the persistence without touching the decision flow |
| `unknown_ac` | Collector yields `[]` for v1 content; resolved Scope AC set still passed | v1 content carries no AC references; documented, additive v2 field plugs in |
| Client approver PII | Copied to the encrypted columns only on `clientApproved`; audit carries ids only | Encryption map covers name/evidence; audit is plain jsonb |
| Project version | `project.updatedAt = now` on every real write | Same as F4; the client's next write must present the new version |
| Trusted execution on F7 | Optional issued object accepted only in-process; lock header required only with a request | Same rule as F3 (the scoping agent submits the Scope artifact through the command bus) |

## Scope

**In scope:** `commands/stages.ts`, `commands/index.ts`, additive `checkProjectArchivable` subject, tests
`commands/__tests__/stages.test.ts`, `scopeChange.test.ts` ids, spec changelog, hand-over.

**Out of scope:** routes/OpenAPI (L14), gate call sites (C21), comment threads (L17), entities/migrations/contracts,
UI/i18n/enterprise, integration specs.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Commands | F7/F8 with locks, replay, guard, seams | Append-only scan on row variable names |
| 2. Tests | Full positive/negative suite with a local store | Unique ids from the kit's `em.create` |
| 3. Spec + hand-over | Changelog, notes, typecheck, lint | — |

**Prerequisites:** T041–T044 on the branch (they are).
**Estimated effort:** one session, three phases.
