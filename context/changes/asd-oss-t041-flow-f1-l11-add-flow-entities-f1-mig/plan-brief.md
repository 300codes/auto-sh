# FLOW-F1 L11 — Plan Brief

> Full plan: `context/changes/asd-oss-t041-flow-f1-l11-add-flow-entities-f1-mig/plan.md`

## What & Why
Persist the F0 flow contract: project template pin columns, intake draft, versioned stage artifacts and append-only
stage decisions, with PII encrypted. Later F1 layers (commands, gate, routes) build on it.

## Starting Point
Five v1 entities and one migration; F0 zod schemas already in `lib/contracts.ts`.

## Desired End State
Additive migration applied; three new tables + seven nullable project columns; encryption map; F1 validator wrappers.

## Key Decisions Made
| Decision | Choice | Why |
|---|---|---|
| Wrappers | nest refined F0 schemas | zod 4 cannot extend refined objects |
| Legacy rows | all `flow_*` nullable, no backfill | FLOW-08 |
| Migration test | static audit in `data/__tests__` | covered by the acceptance jest path |

## Scope
**In:** entities, encryption.ts, validators, migration + snapshot, tests. **Out:** commands, routes, events, F2/F4 tables.

## Phases at a Glance
| Phase | Delivers | Key risk |
|---|---|---|
| 1 | entities, encryption, validators | zod refine/extend pitfalls |
| 2 | migration applied + audited | generator emits unrelated DDL |

**Estimated effort:** ~1 session.

## Open Risks & Assumptions
- Encrypted jsonb columns hold ciphertext strings; decryption via `findWithDecryption` in later layers.
