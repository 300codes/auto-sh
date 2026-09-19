# Plan — AUDIT-FIX OSS polish (T049)

## Phase 1: Gate patch requests

- A1 add `auth.acl.features.delivery_os.*` (11 features incl. FLOW) to en/pl/es/de/ko; en = `acl.ts` titles.
- A2 `yarn template:sync:fix`, keep only the delivery_os registration diff.
- A3 restate P2/P3 for the UI stream (hand-over only).

## Phase 2: Reviewer findings (verified 2026-09-19)

| Id | Verdict | Action |
|---|---|---|
| B1 planBlockPropagation running descendants | **false positive (unreachable)**: reserve rejects `dependency_not_verified`, `dependsOnTaskIds` is editable only in draft/blocked before any attempt, `verified` is terminal → a running task never has a blockable ancestor | retitle the pinning test to state the invariant; add an invariant test; spec sentence |
| B2 fingerprint = payload only | **real**: same key + other baselineHash replays silently | compare mode/baselineHash/baseRevision on replay → `idempotency_conflict`; stored `payloadHash` untouched |
| B3 multi-task cycle | **already covered**: `proposals.test.ts:229`, `planImport.test.ts:295` (A→B→A → 422 cycle) | none |
| B4 offset paging on updatedAt | **real** | keyset on `id` (stable), signature unchanged |
| B5 archive emits no task.updated | **real** | emit after archive |
| B6 three plain `ctx.addIssue` | **real** (detail code `custom`) | `addDeliveryIssue(ctx, 'validation_failed', …)` |
| B7 `manualCheckId: null` | **real** | `== null` |
| B8 `blocked` exemption + `statusReason` name | **real (dead branch)** | drop exemption; rename to `currentStatusReason` |
| B9 changedProjectKeys / persist / updatedAt | **partly**: JSON.stringify real; `em.persist` matches customers convention (keep); `project.updatedAt = decidedAt` is what dirties the row so `onUpdate` bumps the version → not dead (keep) | canonicalize comparison |
| B10 fixtures dist under plain Node ESM | **real** (`ERR_IMPORT_ATTRIBUTE_MISSING` reproduced) | `with { type: 'json' }` added in source (jest/typecheck OK); esbuild target `node18` in `packages/core/build.mjs` strips it → patch request P5 (`target: 'node22'` verified locally) |
| hash integer-like keys | **limitation** (v2: manual sorted serialisation) | spec |
| `change` decision kind | **limitation** (reserved, not a route) | spec |
| react-vite@1 roots | **limitation** (v2 profile) | spec |
| 428 wording | **spec fix** | spec |
| trustedExecution guard tests | R14/R16/R18 covered; add R19 route test | test |

## Phase 3: Triage of all remaining notes, spec drift, hand-over

## References

- `context/changes/delivery-os-oss-domain/handover/OSS-06-final.md`, `OSS-06-gate.md`
- `.ai/specs/2026-09-18-delivery-os-hackathon.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Gate patch requests

#### Automated

- [x] 1.1 A1 auth ACL i18n titles for delivery_os features
- [x] 1.2 A2 template modules parity (delivery_os line only)

### Phase 2: Reviewer findings

#### Automated

- [x] 2.1 B1 block propagation invariant documented and tested
- [x] 2.2 B2 idempotency replay compares mode/baselineHash/baseRevision
- [x] 2.3 B3 multi-task cycle test confirmed
- [x] 2.4 B4 listPendingDeliveries keyset paging
- [x] 2.5 B5 archive emits task.updated
- [x] 2.6 B6 recordEvidenceSchema issues through the catalogue
- [x] 2.7 B7 manualCheckId null/undefined equivalent
- [x] 2.8 B8 correction_limit gate aligned, currentStatusReason rename
- [x] 2.9 B9 canonical changedProjectKeys
- [x] 2.10 B10 fixtures loadable from dist under plain Node ESM
- [x] 2.11 Verify-only items documented as limitations
- [x] 2.12 trustedExecution guard covered on R19 route
- [x] 2.13 Extra cheap fixes from notes (review lock order, planImport acTestMap merge + leftover unique → 409, report 404-before-422, revision max)

Note 2.13: the `revision` `.max()` was reverted — it turned the frozen `422 invalid_revision` for an oversized ref into `400`; the parser already rejects it.

### Phase 3: Triage, spec, hand-over

#### Automated

- [x] 3.1 Triage table with every reviewer note
- [x] 3.2 Spec wording corrected
- [x] 3.3 OSS-06-polish.md written, OSS-06-final.md §3/§6/§7 updated
- [x] 3.4 Scoped verification (jest, typecheck, i18n:check-sync, parity, eslint)

#### Manual

- [ ] 3.5 Human acceptance of Progress 6.1–6.3 after seeing the evidence
