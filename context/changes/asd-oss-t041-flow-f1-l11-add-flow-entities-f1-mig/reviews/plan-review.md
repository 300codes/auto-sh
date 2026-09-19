<!-- PLAN-REVIEW-REPORT -->
# Plan Review: FLOW-F1 L11 — flow entities, F1 migration, encryption map and validators

- **Plan**: context/changes/asd-oss-t041-flow-f1-l11-add-flow-entities-f1-mig/plan.md
- **Mode**: Quick (claims verified inline: entities.ts, validators.ts, contracts.ts, staff/encryption.ts, subscriber.ts json support, zod 4.4.3)
- **Date**: 2026-09-19
- **Verdict**: SOUND (after fixes)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
5/5 paths ✓ (entities.ts, validators.ts, contracts.ts, staff/encryption.ts, migrations/.snapshot), 6/6 F0 symbols ✓, brief↔plan ✓

## Findings

### F1 — New append-only tables not covered by the history audit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2
- **Detail**: `commands/__tests__/appendOnly.test.ts` pins `HISTORY_ENTITIES` to the three v1 history entities; the two new append-only stage tables would not be guarded when F1 commands land.
- **Fix**: add `DeliveryFlowStageArtifact` and `DeliveryFlowStageDecision` to the static `HISTORY_ENTITIES` list.
- **Decision**: FIXED

### F2 — `yarn generate` side effects on committed files not tracked

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 success criteria
- **Detail**: acceptance forbids changes outside delivery_os except generated registries; the plan did not say to check `git status` after `yarn generate`.
- **Fix**: add a `git status` check after generate and list any committed generated file in notes.
- **Decision**: FIXED

### F3 — Encrypted `questions` must be decrypted before step validation

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Decisions
- **Detail**: later layers checking `intake_step_invalid` must read the intake via `findOneWithDecryption`; not in this change's scope.
- **Fix**: note it in the hand-over notes.
- **Decision**: ACCEPTED
