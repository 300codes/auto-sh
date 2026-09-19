# Plan — T066 audit fixes (fast path; the audit is the analysis)

All ten findings verified against the code at `1a5bbf2bc`; none is a false positive.

## Decisions

- Verification evidence kinds allowed: `test`, `screenshot`, `scan`, `review`. `deployment`, `reference_material` and
  `result_manifest` are refused (`422 unsupported_evidence_kind`, path `verification.evidenceId`): the spec says
  `reference_material` never counts as acceptance evidence. A `scan` that is not `passed`, a `review` that is not
  `approved` and a `test` with a non-passed check are refused with the same code (detail `verification_evidence_not_passed`).
- The WordPress URL check in the chain test and the FLOW-07 spec becomes a `scan` evidence (`checkId: publication-url-check`,
  `status: passed`); `wordpress-theme@1` stores scan ids it does not list and they do not affect report gates.
- The kind rule is a pure function in `lib/publicationRules.ts` and replaces the dead `checkPublicationVerification`.

## Phase 1: Fixes (parallel groups A–C by subagents, D by the integrator)

## Phase 2: Docs and verification

## References

- `.ai/specs/2026-09-18-delivery-os-hackathon.md` (FLOW-F0 delta, F14/F15)
- `context/changes/delivery-os-oss-domain/handover/FLOW-F3-F4-lane-b.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fixes

#### Automated

- [x] 1.1 F1 verification evidence kind check (unsupported_evidence_kind)
- [x] 1.2 F2 remap whole-project deploy consent detail path to deployDecisionId
- [x] 1.3 F3 normalise uuids and timestamps before hashing the publication payload
- [x] 1.4 F4 validate releaseDecisionId and remap the snapshotRef attachment path
- [x] 1.5 F5 remove dead exports (checkPublicationVerification, RecordOutcome)
- [x] 1.6 F6 fixture-mark the fake deploy adapter
- [x] 1.7 F7 FLOW-07 integration negatives, second org, 428, self-verification, pinned report gate
- [x] 1.8 F8 flowQueries reuses readPinnedTemplate / readPinnedTemplateRef
- [x] 1.9 F9 merge-hygiene literals and spec status sentence

### Phase 2: Docs and verification

#### Automated

- [x] 2.1 F10 spec clarifications, changelog, F15 coverage row, hand-over and FLOW-progress
- [x] 2.2 Module jest suite, core typecheck, eslint, Playwright list

#### Manual

- [ ] 2.3 Human runs TC-DELIVERY-FLOW-07 against a server with lane-B code after the merge
