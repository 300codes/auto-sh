# FLOW-F0 hand-over — flow delta v1 contracts and fixtures (T040)

> **Contract published; F1 (ops F1–F9) implemented — see `FLOW-F1.md`; F10–F15 still answer 404 until F2–F4 land.** Build UI,
> providers and workflow steps against the schemas and fixtures; integrate against the real API when the F1/F2
> hand-overs name the commit.

- **Base commit:** `0382f9ea2` on `dev-mateusz` (the T040 commit lands after review; `main` last integrated
  `124828233`).
- **Contract versions:** v1 unchanged (`DELIVERY_CONTRACT_VERSION = 1`, 54 error codes, R1–R22). New
  `DELIVERY_FLOW_CONTRACT_VERSION = 1`, `DELIVERY_FLOW_SCHEMA_VERSIONS` (7 documents), `deliveryFlowErrorCodes`
  (14 codes), default template `delivery-default@1`.
- **Spec (authoritative):** [`.ai/specs/2026-09-18-delivery-os-hackathon.md`](../../../../.ai/specs/2026-09-18-delivery-os-hackathon.md)
  § *Flow delta v1 (FLOW-F0)* — data models, operations F1–F15, gate, currency, comment-import rules, coverage.
- **Tests:** `yarn workspace @open-mercato/core jest src/modules/delivery_os/lib --maxWorkers=2` → 22 suites,
  661 tests (53 new); `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` → clean. Runner: local.
- **Master-plan Progress:** none ticked (F0 is a contract; a human records acceptance).

## Where things live

| What | Import | File |
|---|---|---|
| Flow schemas, types, `deliveryFlowErrorCodes`, `deliveryAllErrorCodes`, `parseFlowVersioned`, `deliveryFlowDocumentSchemas`, `FLOW_APPROVAL_STAGE_ORDER` | `@open-mercato/core/modules/delivery_os/lib/contracts` | `lib/contracts.ts` (block "Flow delta v1", append-only) |
| `computeStageCurrency`, `checkFlowGate`, `flowGateBlockers`, `checkPlatformChoiceFrozen`, `hashFlowTemplate` | `…/lib/flowRules` | `lib/flowRules.ts` (pure, no ORM) |
| `DEFAULT_FLOW_TEMPLATE`, `getBuiltInFlowTemplate` | `…/lib/flowTemplates` | `lib/flowTemplates.ts` |
| Fixtures + loaders (`loadIntakeFixture`, `loadScopingProposalFixture`, `loadFlowTemplateFixture`, `loadStageArtifactFixture('scope'\|'ux')`, `loadStageDecisionRequestFixture`, `loadFlowStatusFixture`, `loadCommentImportFixture`, `loadCommentImportResultFixture`, `loadStaffLinkFixture`, `loadPublicationResultFixture`, `positiveFlowFixtures`, `loadNegativeFlowFixtures()`) | `…/lib/fixtures/flow/index` (**with `/index`**) | `lib/fixtures/flow/*.v1.json`, `negative/*.v1.json` |

Parse an incoming flow document with `parseFlowVersioned(deliveryFlowDocumentSchemas, body)`; a route error body is
`{ error, code, details[] }` exactly as v1, with `code` from `deliveryAllErrorCodes`.

## Operation table (condensed — full columns in the spec)

Implemented at: F1/F2/F3/F4/F6 routes `b995312c3`; F5 command `ec0502d7a`; F7/F8/F9 `04e13ab01` (commands) + `b3d3581de` (routes); integration specs FLOW-01/02/09 `e71dc11c4`. F10–F15: pending (F2–F4).

| # | Operation | Owner who calls it | Body / result schema |
|---|---|---|---|
| F1 | `GET /projects/:id/intake` | Adam (wizard resume) | `intakeResponseSchema` |
| F2 | `PUT /projects/:id/intake` (lock = intake `updatedAt`) | Adam (wizard autosave) | `intakeUpdateRequestSchema` (no `proposals` — server-owned, only F3 writes them) → `intakeResponseSchema`; `422 target_profile_frozen` if `platform.chosen` ≠ project profile |
| F3 | `POST /projects/:id/intake/proposals` (idempotent by `manifestId`) | Marcin (scoping agent, propose-only) | `scopingProposalV1Schema` → `scopingProposalImportResponseSchema` |
| F4 | `POST /projects/:id/flow/pin` (write-once) | Adam (after create) / Marcin | `flowPinRequestSchema` → `flowPinResponseSchema` |
| F5 | command `delivery_os.flow.link_instance` (trusted) | Marcin (project workflow) | `flowInstanceLinkSchema` |
| F6 | `GET /projects/:id/flow` | Adam (stage/blockers/pending), Marcin (wait conditions) | `flowStatusV1Schema` |
| F7 | `POST /projects/:id/stages/:stageId/artifacts` | Adam (Figma UX/KV/DS-UI), Marcin (agent scope), UI manual | `stageArtifactV1Schema` → `stageArtifactCreateResponseSchema` |
| F8 | `POST /projects/:id/stages/:stageId/decisions` (`Idempotency-Key` header, replay = same key + same body) | Adam (approval UI, client approver name + evidence) | `stageDecisionRequestSchema` → `stageDecisionResponseSchema` |
| F9 | `GET …/stages/:stageId/{artifacts,decisions}` | Adam (history) | list of the documents |
| F10 | `PUT/GET /projects/:id/staff-link` | Adam (link Kanban) | `staffLinkRequestSchema` → `staffLinkSchema` |
| F11 | `POST /projects/:id/comment-imports` (`Idempotency-Key`) | Adam's Figma provider | `commentImportBatchV1Schema` → `commentImportResultSchema` |
| F12 | `GET /projects/:id/comment-threads` | Adam (sync screen) | thread list |
| F13 | `POST /projects/:id/comment-threads/:threadId/triage` (lock = thread) | Adam | `commentThreadTriageRequestSchema` |
| F14 | `POST/GET /projects/:id/publications` | Michał's deploy adapter / Marcin's host | `publicationResultV1Schema` → `publicationRecordResponseSchema` |
| F15 | R22 report `flow` section | Adam (report) | `deliveryReportFlowSectionSchema` |

Gate refusals on the **v1 routes** (task ready, reserve, deploy decision) keep the v1 code `422 baseline_not_approved`
with one `details[]` entry per stage (`path: stages.<id>`, `code: stage_not_approved | stage_dependency_stale`), so
existing clients keep parsing; the new flow routes answer `422 stage_not_approved`. The v1 report gates are untouched;
stage blockers live only in the optional `flow.gate` section.

ACL to request in role setup (additive, F1): `delivery_os.flow.manage`, `delivery_os.stages.approve`,
`delivery_os.comments.import`. Everything else reuses v1 features.

## Fixture list and what each proves

| Fixture | Proves |
|---|---|
| `flow-template.v1.json` | the default template; equals `DEFAULT_FLOW_TEMPLATE`; `hashFlowTemplate` changes on any config change (client flag, approvers, conditions), not only topology |
| `intake.v1.json` | wizard state at step `platform`: answered blocking question, one scope proposal ref, WP recommended and chosen |
| `scoping-proposal.v1.json` | agent output: questions (unanswered) + full `ScopeContent` with AC; `kind` ⇄ content rule |
| `stage-artifact.scope.v1.json`, `stage-artifact.ux.v1.json` | scope from intake; ux from Figma bound to the scope hash (`dependsOn`) with a screen snapshot |
| `stage-decision.request.v1.json` | Key Visual approval with client approver + meeting evidence |
| `flow-status.v1.json` | read model mid-flow: scope/ux approved, KV pending client approval, DS-UI missing; gates closed with the same blockers |
| `comment-import.v1.json` / `comment-import.result.v1.json` | one Figma thread + one reply with version → one staff task + one comment, `versionConfirmed: true`, cursor advanced |
| `staff-link.v1.json` | link with a per-file sync cursor |
| `publication-result.v1.json` | verified WP preview publication bound to a deploy decision and a deployment evidence row |
| `negative/*` (15) | schema-stage rejections: unknown version, invalid step, scope proposal without content, unknown stage, dependency not upstream / duplicated, reject without reason, empty client approver, duplicate thread/comment keys, missing thread key, template duplicate stage / cycle, verified publication without evidence, deferral without reason |

Domain-stage rejections (need rows, tested in F1/F2 integration): frozen-profile mismatch on F2/F7, stale dependency
against the DB, client approval required by template, open blocking comments, staff link missing, foreign project /
staff task / file ids, cursor conflict, active attempt on a new artifact.

## Open questions and the decision taken

| Question | Decision (D-id in `context/changes/asd-oss-t040-flow-f0-publish-the-versioned-contra/plan.md`) |
|---|---|
| Where does the wizard draft live? | Own table `delivery_intakes` with its own lock and encryption map (D1); the project lock is not affected by autosave |
| Can Scope change the platform? | No. `platform.chosen` must equal the frozen project profile (`422 target_profile_frozen`); the recommendation is stored for the record; another platform = a new project (D2). Demo preselects `wordpress-theme@1` at creation |
| UX/KV/DS-UI vs legacy `design`? | New table + `stage` enum + feature; legacy `requirements`/`design` still required for the v1 baseline (D3). The UI may record the legacy `requirements` decision together with the Scope approval as two rows |
| Who is gated? | Only projects with a pinned template; legacy projects unchanged (D4). Gate runs inside `ready`, reserve (both modes), deploy decision and publication (D5) |
| How is "stale" stored? | It is not; `computeStageCurrency` derives it from append-only rows (D6) |
| Template pin | Snapshot + hash on the project, write-once, instance linked by trusted command (D7) |
| Comment import unit and limits | One transaction per thread, unique external keys, batch `Idempotency-Key`; staff limits (title 255 / description 8000 / comment 5000) → truncation marker, full text on the delivery row (D8, D9) |
| Done ⇒ verified? | Never (D10); no delivery subscriber to staff status events |
| Report / R19 | Separate `flow` section (D11); publication is a new document + route that records `deployment` evidence internally (D12) |
| Are blocking comments part of the approval? | Yes: open un-triaged threads on the current artifact block approval unless deferred for that hash (D13) |
| Template registry | DI `deliveryFlowTemplateProvider`; OSS default returns the built-in template so OSS-only works; Marcin's provider replaces it |

## Estimate (domain, on top of the original OSS 23 h)

| Phase | Work | Hours |
|---|---|---|
| F1 | intake + proposals, pin + instance link, stage artifacts + decisions, gate in `ready`/reserve/deploy, flow status, migration, FLOW-01/02/09 | ≈ 10 |
| F2 | staff link, comment import (per-thread tx, staff commands), triage, thread list, encryption, migration, FLOW-03/04 | ≈ 8 |
| F3 | report `flow` section, template provider seam, events/ACL/DI registration, `yarn generate` | ≈ 4 |
| F4 | publications route, FLOW-08 regression, final gate | ≈ 4 |

## Blockers (explicit)

- **Figma comments** — read access and whether `figmaVersion` comes with a thread (Adam's probe). The contract
  tolerates `null` (`versionConfirmed: false`), so the domain is not blocked; the live FLOW-03 run is.
- **Template provider** — Marcin's workflows-backed `deliveryFlowTemplateProvider`. OSS ships the built-in default;
  Studio-published v2 needs his provider.
- **Publication target** — Michał's target + verification access. F14 accepts `unverified` results; a `verified`
  one needs a real check with an evidence row. Fixture publications never count as live.
- **Implementation status** — F1–F9 implemented (commits in `FLOW-F1.md`; routes at `b995312c3` / `b3d3581de`, specs at `e71dc11c4`). Do not point demo flows at F10–F15 (comments, staff link, publications) before the F2/F4 hand-overs name a commit.
