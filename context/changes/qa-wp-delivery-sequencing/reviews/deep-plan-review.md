<!-- PLAN-REVIEW-REPORT -->
# Deep plan review — QA + WordPress sequencing

- Plan: [plan.md](../plan.md)
- Date: 2026-09-19
- Scope: independent verification of locks/recovery, deployment completeness, EXEC cancellation, runtime parallelism and acceptance criteria. Read-only code review; no implementation or runtime changes.
- Verdict: SOUND after targeted re-review; no open blockers. Initial findings retained below for traceability.
- Findings: 0 critical; two warnings fixed, one observation dismissed after inspecting newer evidence.

| Dimension | Verdict |
|---|---|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | PASS |

## Grounding

Verified six existing paths: ownership.ts, tools.ts, snapshot.ts, theme-build.ts,
deliveryDbFixtures.ts and Playwright config. New helper paths are explicitly proposed,
not incorrectly represented as existing. Progress contains one final section with all
six matching phase headings and mirrored success bullets. Historical cap removal and
continuation through independent branches agree with the current instruction.

## Findings

### F1 — Choose concrete lock composition and durable partial-apply barrier

- Severity: WARNING
- Impact: MEDIUM — narrow architectural choice before implementation.
- Dimension: Architectural Fitness / Blind Spots
- Location: plan Phase 2, lines 160–165.
- Detail: The plan offers either one coordinator lock or separately locked operations, but existing `buildOwnedTheme` acquires `operation.lock` itself (`theme-build.ts:122`). `tools.stop` and `captureSnapshot` also acquire it (`tools.ts:139,153`). `withSiteLock` retains a lock on throw but removes it after successful callback (`ownership.ts:55–65`). The first option therefore needs an explicit internal lock-free work seam; directly nesting current helpers will refuse execution. The second permits a crash after successful apply releases its lock but before enqueue/build acquires another. Current snapshot checks no prepare journal, so merely writing a journal does not enforce the promised snapshot/publication block.
- Fix: Select one composition in the plan and name its touched helpers. Prefer one coordinator-owned operation lock with internal work functions that cannot acquire it again; preserve existing standalone wrappers. Alternatively, define a durable prepare barrier checked by every relevant snapshot/upload entrypoint, with owner/run identity and explicit reconciliation policy. Add fault injection after successful apply/before build, and assert snapshot/upload refusal until reconciled; specify how owned stop/recovery works without bypassing an uncertain lock.
- Confidence: HIGH — direct inspection of existing wrappers and lock semantics.
- Decision: FIXED — root selected coordinator-held operation.lock and internal non-reentrant work primitives; REC not_run explicitly leaves criterion incomplete.

### F2 — Keep not_run recovery accounting distinct from completed live acceptance

- Severity: WARNING
- Impact: LOW — clarify the checkbox semantics.
- Dimension: Plan Completeness
- Location: Phase 4 success criterion 4.1 and its Progress mirror.
- Detail: The criterion combines “real checkpoints/counters” with “unexecutable explicitly not_run”. This can be read as satisfied by recording not_run for all G3-dependent scenarios, although the surrounding plan correctly requires actual live evidence and retains unmet acceptance. Preparation should be finishable without treating live recovery as accepted.
- Fix: State explicitly that a dependency matrix/not_run record completes preparation only; keep 4.1 unchecked until its required live cases pass, or split preparation and live acceptance into separate mirrored criteria. Preserve concrete owner/contract blockers in handoff.
- Decision: FIXED — root selected coordinator-held operation.lock and internal non-reentrant work primitives; REC not_run explicitly leaves criterion incomplete.

### F3 — Distinguish snapshot-safe CSS from an actually captured built-site snapshot

- Severity: OBSERVATION
- Impact: LOW — tighten the historical evidence description.
- Dimension: End-State Alignment
- Location: entry-state table, Tailwind/tokens row (“CSS w snapshotcie”).
- Detail: Builder evidence proves real fixture compilation and uses `assets/dist/tailwind.css`, which is accepted by the existing snapshot file policy. The reviewed builder report explicitly leaves actual Studio build/enqueue not_run. A snapshot of that built owned site is not demonstrated by those reports alone. The plan already places actual captured CSS hash in 2.3.
- Fix: Describe existing result as “CSS path included by snapshot policy” unless linking a concrete captured artifact containing the built CSS hash; leave actual capture proof to 2.3.
- Decision: DISMISSED — newer live local-site-build.json and built-site-snapshot.json prove the generated CSS was captured; this reviewer initially inspected the earlier fixture gate only.

## Verified risky claims

- **Full deployment is not v1 snapshot:** `snapshot.ts:18–19` captures theme and SQLite only; canonical manifest binds `databaseHash` and `themeFiles`, without plugins/media/runtime. Plan Phase 5 correctly requires a separate versioned deployment manifest, consistent DB backup and proof of transferred bytes, retaining v1 semantics. Probe-first adapter work and explicit local-versus-rewritten remote identity are appropriate. Runtime limits and allowed-content/secret policy must be finalized in that probe-specific implementation plan before upload.
- **EXEC cancellation conflict is real:** EXEC-04 spec line 204 says import `outcome: cancelled`; current `attempts.ts:377,384` rejects cancelled results, and TC007 asserts `attempt_cancelled`. Enterprise `delivery_agents/di.ts` is still a bridge-registration stub; the adapter alone is not execute/park/resume. Plan correctly requires the owners' contract decision instead of weakening v1 tests.
- **Parallelism is feasible at code level:** Q/W1/W2 file ownership plus root integration fit four agent slots. Heavy OM build and Studio/live workers are serialized absent measured headroom; same-site build/apply/browser/snapshot cannot overlap; REC08 is the explicit controlled exception using distinct worktrees. No additional runtime is implied by documentation work.
- **Acceptance is concrete elsewhere:** frontend and editor must actually apply CSS; theme.json preserves styles/DB; native editor requires the chosen actor rather than admin-only proof; redeploy changes files/build rather than replaying plugins. Preview is gated on candidate/target approval and read-only exact-version evidence, with no remote repair/build.
- **Ordered gate matches current config:** the eight commands listed in the plan match `.ai/agentic.config.json`. Existing OOM and narrow checks remain separate; current source manifests include uncommitted deltas rather than pretending HEAD identifies them.

## Blast radius and reuse

Existing lock wrappers are shared by create/start/stop/snapshot, demo plugins/native and
builder. A lock helper behavior change would affect all of them and is unnecessary; any
new coordinator should preserve current wrappers and use narrow internal seams. Reuse
existing scoped status/ownership, path guards, atomic file writes and byte-hash reporting.
Do not extend the frozen v1 snapshot manifest to silently cover plugins/media. Deployment
preparation is independent until host/approval integration; do not stop all local work at
G1/G3, and do not claim those gates passed from fixture evidence.

## Final re-review

The revised Phase 2 names one coordinator-owned operation.lock and root-owned builder
refactor, preserving lock-owning standalone wrappers. Crash/throw keeps the existing
lock, so snapshot refuses until explicit reconciliation. Test requirements include
failure between steps and snapshot refusal. Phase 4.1 now explicitly remains incomplete
when required cases are not_run. Both changes resolve the actionable warnings.

Live build and snapshot evidence independently inspected: same siteId and generated CSS
SHA256 `06c83183e6ef46d7f0f40f8272a57350096eed574a75eed6ac6f79da5b68a1ab`. Enqueue remains not_run, accurately distinct from capture.
Verdict: SOUND for implementation, with external design/EXEC/approval gates unchanged.
