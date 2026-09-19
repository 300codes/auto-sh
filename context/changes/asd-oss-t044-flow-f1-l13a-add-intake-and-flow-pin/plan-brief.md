# FLOW-F1 L13a — Intake and Flow-Pin Commands — Plan Brief

> Full plan: `context/changes/asd-oss-t044-flow-f1-l13a-add-intake-and-flow-pin/plan.md`

## What & Why

The brief wizard, the agent scoping proposal, template pinning and the workflow instance link need real commands so
Adam's wizard UI and Marcin's project workflow can persist state through the command bus. The pure rules (T042/T043)
and the tables (T041) exist; this task adds the write path with locks, replay, trusted execution and audit.

## Starting Point

`lib/intakeRules.ts` decides every intake outcome, `lib/flowRules.ts` hashes templates, `commands/shared.ts` gives
scope, locks and frozen errors, and `commands/attempts.ts` shows the trusted internal command pattern. No command yet
touches `DeliveryIntake` or the project `flow*` columns.

## Desired End State

`delivery_os.intake.update`, `delivery_os.intake.import_proposal`, `delivery_os.flow.pin` and the trusted
`delivery_os.flow.link_instance` are registered and unit-tested; the three flow ACL features, four flow events and the
`deliveryFlowTemplateProvider` DI default are declared; every existing delivery_os suite stays green.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Intake lock resource | Own resource kind `delivery_os.intake`; current = intake `updatedAt` or project `createdAt` on first write | Spec F2: autosave never bumps the project lock, and F1 hands the client `createdAt` when no row exists |
| Serializing lazy creation | Project row lock (no version check) + intake row lock inside one transaction | Unique constraint per project can never fire, so no unique-violation recovery is needed |
| Replay before lock (F3) | Unlocked probe with `mergeScopingProposal`, then the same call under lock | One code path decides duplicate vs conflict; a duplicate never needs a lock header |
| Proposal document | Not stored (no column in T041); ref + hash + recommendation only | Scope content enters through the F7 stage artifact; adding a column is out of task scope |
| Trusted execution on F3 | Optional issued object accepted only in-process; HTTP call with it → 403 | Same rule as `attempts.reserve` automatic mode; the agent proposes through the command bus |
| Template provider contract | `getTemplate` returns `FlowTemplateV1`, `{ template, hash }` or `null` | Lets a provider publish its hash so `flow_template_hash_mismatch` is testable; additive to the spec |
| Pin ordering | Provider + hash checks before any lock; write-once under `lockProjectForWrite` | Most actionable error first; the project lock is only taken for a real write |
| Audit snapshots | Ids, step, counts and platform choice only | Audit log is plain jsonb; brief text and question text are PII under the encryption map |

## Scope

**In scope:** `commands/{intake,flow,flowTemplateProvider}.ts`, `commands/index.ts`, `commands/shared.ts` helpers,
`acl.ts`, `setup.ts`, `events.ts`, `di.ts`, tests `commands/__tests__/{intake,flow}.test.ts`, updates to
`scopeChange.test.ts` and `__tests__/module-registration.test.ts`, `yarn generate`.

**Out of scope:** routes/OpenAPI (L14), stage commands and gate call sites (L13b), integration specs, entities or
migrations, UI/i18n/enterprise, staff/workflows coupling.

## Architecture / Approach

Each command: parse → scope → pre-lock checks (replay probe, provider lookup, trusted check) → transaction with
`PESSIMISTIC_WRITE` row locks → pure rule → ORM persist (encryption map applies on flush) → events after commit →
audit `buildLog`. The template provider is one DI registration Marcin overrides.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Registries | ACL, setup, events, DI default + registration test | Event payload field type for arrays |
| 2. Intake commands | F2/F3 with lock order, stripping, frozen profile, replay | Lock semantics on the first write |
| 3. Flow commands + gate | F4/F5, scopeChange expectations, generate, typecheck | Internal-id source scan in `scopeChange` |

**Prerequisites:** T041–T043 on the branch (they are).
**Estimated effort:** one session, three phases.

## Open Risks & Assumptions

- The full proposal document is not persisted; if F7 needs it server-side, a column must be added in a later task.
- `enforceCommandOptimisticLock` is fail-open without a header; the 428 relies on `requireLockHeader` for HTTP calls.

## Success Criteria (Summary)

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` green, including registration,
  scopeChange, appendOnly, enterprise boundary and the decoupling test.
- Core typecheck green; `yarn generate` clean.
- Every failure path in the spec rows F2–F5 has a test with the frozen error body.
