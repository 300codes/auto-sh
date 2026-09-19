<!-- IMPL-REVIEW-REPORT -->
# Implementation review — WordPress Studio tools

Date: 2026-09-19. Scope: phases 1–3, independent tools and local caller.
User explicitly authorized autonomous plan/review/implementation/review and fixes without questions.
Manual acceptance 3.5 remains pending. No domain acceptance or public preview is inferred.

## Findings and decisions

### F1 — Partial CLI evidence lost after later failure

Severity: WARNING. Impact: MEDIUM. Location: src/cli-support.ts.
Decision: FIXED. Reports retain scope, attempt, site identity and known successful site/snapshot checks.
Follow-up review found unknown create substeps labelled not_run: FIXED by omitting unknown internal checks.
Only subsequent unstarted snapshot/HTTP steps are marked not_run. Regression tests cover stage failures and redaction.

### F2 — HTTP inactivity timeout was not an absolute deadline

Severity: WARNING. Impact: MEDIUM. Location: src/cli-support.ts.
Decision: FIXED. Shared monotonic 30-second readiness deadline, bounded retries of temporary failures,
2 MiB body limit, no redirect following. Live Studio emits a same-URL 302 on the first request after restart; only an exactly identical normalized URL may be retried, within the original deadline. A different path, query or origin is rejected. Tests cover continuous streams, repeated transient status,
reset, eventual success, permanent denial and redirects.

### F3 — Uncertain stop lacked explicit reconciliation signal

Severity: WARNING. Impact: MEDIUM. Location: src/tools.ts.
Decision: FIXED. snapshot_stop_unconfirmed preserves operation lock; no snapshot or restart follows
an unconfirmed external stop. Tests also block concurrent start/capture while snapshot owns the lock.

### F4 — Independence/provenance checks needed executable evidence

Severity: WARNING. Impact: LOW. Location: src/__tests__/tools.test.ts.
Decision: FIXED. Injected runner forces fixture provenance. Complete fake-tool flow runs with all
fetch/http/https requests denied. Real CLI calls Studio/Git directly and has no old server configuration.
The previous server was still reachable; it was not stopped, preserving prior authorization to recover runs.

### F5 — Contract documentation conflated create and lifecycle correlation

Severity: OBSERVATION. Impact: LOW. Location: plan/spec/README.
Decision: FIXED. create owns attempt/idempotency; start/stop use scope/handle; append-only snapshots
have toolExecutionId plus creationAttemptId. New cli-support helper and generated workspace lock entry documented.

### F6 — Subprocess stdout test failure in sandbox

Severity: OBSERVATION. Impact: LOW. Location: runner test environment.
Decision: DISMISSED as environment artifact. Even a trivial child Node process lost stdout in sandbox.
Real subprocess tests outside sandbox pass. No production workaround was added.

## Verification

Local runner (no active compose app): npm run typecheck, npm run build, npm test: PASS, 29/29 tests.
Final full suite rerun after reporting/readiness fixes; typecheck and build passed. Compiled dist/index.js import: PASS.
Yarn 4.17.1 generated exactly the new workspace entry (10 lines). Existing peer warnings remain.
Validation toolchain: Node 24.13.1, Zod 4.4.3, TS 5.9.3, Node types 25.9.2; full root gate not run.
Two independent reviews covered plan drift and safety/patterns; final follow-up confirmed controls after fixes.
Live trial status and final verdict are recorded in the handoff after completion.

## Live startup finding

Studio 1.19.0 returned 302 to the same host/path on the first GET after each restart;
a subsequent unchanged GET returned 200 with the new theme. Initial CLI attempts correctly
remained blocked and retained successful snapshot evidence. Readiness now retries only
an exactly identical normalized redirect target without following Location. Regression
tests must reject changed origin/path/query and bound persistent self redirects.

## Final verdict

| Dimension | Verdict |
|---|---|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS after fixes |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | Automated PASS; manual 3.5 pending |

Overall: **APPROVED for the independent local scope**. All findings resolved; no
claim of full OM integration, visual acceptance or public deployment. Final compiled
CLI replay: status created, same site identity, real snapshot and HTTP 200. See
[handoff](../../../../hackathon/delivery-demo/wordpress-reuse.md) for evidence and limits.

Implementation was verified as one integrated package before committing because
contract, ownership, snapshot and CLI depend on one another. A consolidated implementation
commit records all automated phase work; an epilogue records its SHA. User instructed
autonomous progression through all four skills; no interactive gates were requested.
