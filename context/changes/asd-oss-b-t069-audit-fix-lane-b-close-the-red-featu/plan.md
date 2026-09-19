# Plan — T069 AUDIT-FIX lane B

Every finding was checked against the code on `dev-mateusz-flow-b`; all ten are valid, no false positives.

- F1 (blocker) `src/__tests__/feature-policy-authorization-coverage.test.ts` is RED, naming
  `commands/publications.ts` and `lib/stageDecisions.ts` (confirmed by running it). Both authorize a live
  subject with `hasAllFeatures` → route through `authorizeFeatures(required, { grantedFeatures })`.
- F2 `commands/flowGate.ts:87` returns `'unreadable'` only on a snapshot parse failure, while
  `flowQueries.ts:107` / `reportQueries.ts:95` also fail closed when `readPinnedTemplateRef()` is null.
- F3 `lib/flowStatus.ts attemptBlockers` is uncapped, `flowStatusV1Schema.blockers` / `flowGateSchema.blocking`
  are `.max(200)`.
- F4 `commands/publications.ts:160` compares revisions with `hashCanonical` instead of
  `sourceRevisionSchema.safeParse` + `isSameRevision`.
- F5/F6 F14 route: incomplete 422 doc list; `orderBy` ties broken by a random uuid.
- F7 `publication-result.v1.json` lacks the `*.example.test` / `fixture:` markers.
- F8 three shared literals reflowed to multi-line (lane-rule violation; lane A keeps them single-line).
- F9 vacuous non-strict `safeParse` assertion in `reportFlow.route.test.ts`; no unit case for the
  `approvingDecisionOf` behaviour change.
- F10 no HTTP-level negative that the frozen v1 routes refuse a pinned, unapproved project.
- F11 integration-spec hygiene (swallowed cleanup, `as` casts).

## Decisions

- **F3: cap the producer, do not raise the schema bound.** A new `FLOW_BLOCKER_LIMIT = 200` in
  `lib/flowStatus.ts` truncates `attemptBlockers` (newest kept) and the composed `blockers` /
  `gates.*.blocking` arrays. `ok` is computed before truncation, so a cap can never open a closed gate.
  Keeps `lib/contracts.ts` (a shared registry) untouched, so the lane-A merge stays trivial.
- **F2: the F14 half of the new case lives in `commands/__tests__/publications.test.ts`**, next to its
  existing `fails closed when the pinned snapshot is unreadable` sibling; `flowGate.test.ts` gets the four
  v1 paths. Wiring `publications.record` into `flowGate.test.ts` would duplicate ~150 lines of fixture setup.
- **F1: keep the fail-closed `granted = []` behaviour** in `publications.ts`; only the matcher call changes.
  Argument order differs between the two files — `authorizeFeatures(required, { grantedFeatures })` in both.

## Phase 1: Fixes

Three subagents on disjoint file groups; the orchestrator integrates and verifies.

- A+C — `commands/publications.ts`, `lib/stageDecisions.ts`, `api/projects/[id]/publications/route.ts`,
  `lib/fixtures/flow/publication-result.v1.json` and their tests (F1, F2-F14 half, F4, F5, F6, F7).
- B — `commands/flowGate.ts`, `lib/flowStatus.ts` and their tests (F2 v1 half, F3, F9b).
- D — `api/__tests__/{routeTestKit,reportFlow.route,flowStatus.route}.ts`,
  `commands/__tests__/scopeChange.test.ts`, the FLOW-07 integration spec (F8, F9a, F10, F11).

## Phase 2: Verification

`yarn generate` (route doc text changed), core jest `src/__tests__` and `src/modules/delivery_os`
(`--maxWorkers=2`), scoped core typecheck, eslint on the module, Playwright `--list TC-DELIVERY-FLOW-07`.

## References

- T069 task description (audit findings); `.ai/specs/2026-09-18-delivery-os-hackathon.md`;
  `context/changes/delivery-os-oss-domain/handover/FLOW-F3-F4-lane-b.md`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fixes

#### Automated

- [x] 1.1 F1 publications + stageDecisions authorize through authorizeFeatures (gate green)
- [x] 1.2 F2 flowGate fails closed on a corrupt pinned template ref (+ v1 and F14 cases)
- [x] 1.3 F3 flow-status blockers capped to the published schema bound (+ boundary test)
- [x] 1.4 F4 publication verification revision compared via sourceRevisionSchema + isSameRevision
- [x] 1.5 F5 F14 OpenAPI 422 list covers foreign_release_decision and the snapshot attachment case
- [x] 1.6 F6 publication list ordering is deterministic
- [x] 1.7 F7 publication fixture carries the example.test / fixture: markers
- [x] 1.8 F8 shared test literals restored to single-line append form
- [x] 1.9 F9 report-flow key assertion and the mixed-version flowStatus case
- [x] 1.10 F10 HTTP-level v1 gate negative on a pinned, unapproved project
- [x] 1.11 F11 FLOW-07 spec strict cleanup and schema-parsed fixtures

### Phase 2: Verification

#### Automated

- [x] 2.1 core src/__tests__ jest green (feature-policy gate passes)
- [x] 2.2 delivery_os jest suite green with --maxWorkers=2
- [x] 2.3 scoped core typecheck and eslint clean
- [x] 2.4 Playwright --list TC-DELIVERY-FLOW-07 lists 5 tests (not run — standing blocker)
