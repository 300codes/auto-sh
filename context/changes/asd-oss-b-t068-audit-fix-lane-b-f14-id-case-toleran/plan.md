# Plan — T068 AUDIT-FIX lane B

All findings were checked against the code on `dev-mateusz-flow-b` and all are valid (no false positives):
- A1 `commands/publications.ts:147` compares `row.baselineId` with the raw body value → use the loaded `baseline.id`.
- A2 `data/validators.ts` `recordPublicationCommandInputSchema` compares projectId case-sensitively → lowercase both sides.
- A3 F14 OpenAPI 422 text is missing `unsupported_evidence_kind`, `baseline_mismatch` and the evidence `revision_mismatch`.
- B4 `commands/flowQueries.ts` returns normal gates when the snapshot parses but `readPinnedTemplateRef` is null; F15 fails closed → parity.
- C5 FLOW-07 spec swallows cleanup errors and does not check users/orgs/tenants → strict cleanup, plus new 403/pagination/pageSize cases.
- D6/D7: spec and hand-over docs (append-only in shared docs).

Decisions: A1 passes the loaded baseline into `assertVerificationEvidence` (the DB already matched the id case-insensitively). B4 changes the return condition to `!pinned || (template && templateRef)`.

## Phase 1: Fixes

Groups A (by the orchestrator), B, C, D (subagents) touch disjoint files.

## Phase 2: Verification

Core jest for delivery_os (`--maxWorkers=2`), scoped core typecheck, and Playwright `--list TC-DELIVERY-FLOW-07`.

## References

- Task T068 description (audit findings), `.ai/specs/2026-09-18-delivery-os-hackathon.md`, `handover/FLOW-F3-F4-lane-b.md`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fixes

#### Automated

- [x] 1.1 A1 F14 verification evidence baseline compared via loaded baseline id
- [x] 1.2 A2 publication command projectId compared case-insensitively
- [x] 1.3 A3 F14 OpenAPI 422 description lists all codes
- [x] 1.4 B4 F6 fails closed on unreadable pinned template ref (+ read-only and DI foreign-org tests)
- [x] 1.5 C5 FLOW-07 spec strict cleanup, view-only 403, pagination and pageSize cases
- [x] 1.6 D6 spec lines (flowStatus signature, publications row, lane-B status line, changelog)
- [x] 1.7 D7 hand-over merge notes, UI codes, errors list, estimate, fixture-marker note

### Phase 2: Verification

#### Automated

- [x] 2.1 delivery_os jest suite green with --maxWorkers=2
- [x] 2.2 core typecheck green (concurrency 2)
- [x] 2.3 Playwright --list TC-DELIVERY-FLOW-07 lists the spec

Evidence: `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` → 96 suites / 1815 tests passed; `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` → green; scoped test tsconfig (`/tmp/t068/tsconfig.json`) shows no new errors, only the known TS2882 self-import and routeTestKit TS7022/TS7024; Playwright `--list TC-DELIVERY-FLOW-07` lists 5 tests. Review: a short hand-written review of the diffs (same approach as T066). One correction: the spec status line was restored to lane A's exact text, as the audit asked, instead of the merge-base text.
