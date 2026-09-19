---
topic: "Plan-proposal import (R10) — what exists and what the command must add"
researcher: autonomous OSS developer (T022)
date: 2026-09-19
---

# Research: plan-proposal import

Focused code reading (no sub-agents; the area was built by T011, T019, T021 of this stream).

## Code References

- `lib/proposals.ts:362` `validatePlanProposal(manifest, { project, baseline, profile })` — pure; returns `tasks` in
  dependency order, merged `acTestMap`/`declaredTests`, `baselineContent` (parent spread + plan section +
  `importedManifestHashes`) and `contentHash`. It does NOT write `importedManifests [{manifestId, manifestHash}]`, and
  there is no identity-only parser like `parseRequirementsProposal` (`lib/proposals.ts:165`).
- `commands/baselines.ts:261` `delivery_os.baselines.import_requirements` — the pattern to mirror: 404 → manifest
  identity → replay under the project row lock (`findImportedManifest`, lowest version wins) → `requireLockHeader` →
  `lockProjectForWrite(force)` → validate → persist → unique-violation recovery → side effects after commit.
  `listProjectBaselines`, `findImportedManifest`, `emitBaselineCreated` are private there.
- `commands/tasks.ts:487` `delivery_os.tasks.create` answers `unsupported_source` for `plan_proposal`;
  `checkReadyGate` (`:321`) refuses `ready` when `task.baselineId !== project.activeBaselineId` or a decision for the
  baseline hash+version is missing — so tasks of a not-yet-approved merged baseline are already gated.
  `emitTaskSideEffects`, `emitTaskUpdated`, `findProjectBaseline` are exported; `readBaselineContent`,
  `foreignBaselineError`, `unreadableBaselineError` and the decision-record mapping are private.
- `lib/baseline.ts:221` `resolveActiveBaseline(decisions, { contentHash, version })` — both kinds approved for hash+version.
- `data/entities.ts:121` partial unique `delivery_tasks_proposal_key_uq`; `:71` baseline uniques on version and hash.
- `api/projects/[id]/tasks/route.ts` — R10 already enforces `results.import` for `plan_proposal`, uses the uncapped
  `readRouteBody`, always dispatches `delivery_os.tasks.create`. R7 (`baselines/route.ts`) shows COMMAND_BY_SOURCE +
  `readCappedRouteBody`.
- Spec `.ai/specs/2026-09-18-delivery-os-hackathon.md` UA-07 row: `201 { baselineId, tasks: [{ id, proposalTaskKey,
  updatedAt }], duplicate }`; "Replay before lock" rule covers R10.
- Tests: `commands/__tests__/baselineTestKit.ts` store has no tasks; `api/__tests__/routeTestKit.ts` store has all
  entities and counts writes. `lib/__tests__/proposals.test.ts:316-338` pins `importedManifestHashes`, not a literal hash.

## Architecture Insights

- The merged baseline embeds the manifest identity, so its content hash is unique per manifest; replay by
  `manifestId` is the real idempotency path, unique violations are a race net only.
- Breakdown §7 binding decision: the merged baseline is a new version needing both decisions; the import never flips
  `activeBaselineId`.
