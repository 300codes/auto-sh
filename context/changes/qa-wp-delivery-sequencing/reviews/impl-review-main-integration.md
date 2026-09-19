<!-- IMPL-REVIEW-REPORT -->
# Implementation review: integration of current main

- Plan: `../plan.md`; integration requested by user on 2026-09-19.
- Base: `92bcb813dac3c464ac9114b7acb9a8c80d8b0549` plus local QA/WP changes.
- Scope: evidence-command merge and narrow EXEC integration repairs; not full E2E acceptance.
- Verdict: APPROVED for the evidence merge and narrow EXEC repairs; full E2E remains open.

## Evidence merge

Upstream acquires scoped pessimistic task locks before reading review history.
The local latest-accepted-result guard remains: naming an older attempt cannot approve
or reject a newer result, even when both revisions have the same hash. The former
second read/replay check is redundant under upstream's lock ordering and was removed.
An independent reviewer confirmed the merged production path.

The first focused run found two outdated local concurrency mocks, not a production
failure: they hid the committed review until a second read that no longer exists.
The corrected tests commit the competing review at lock acquisition, assert exactly
`lock_tasks → load_task_evidence`, and retain duplicate/no-write/no-event assertions.
Both command suites then passed **100/100**, with zero pending tests. See
`../evidence/q-preparation/current-main-focused-jest.json` for sources and runner.

## EXEC repairs under review

The command bus returns an envelope, so reservation and acceptance must read `.result`.
Adapter result acceptance must use the existing issued capability and actual actor UUID;
an object with matching JSON fields is not authority. Domain acceptance must also decide
duplicate versus conflict, rather than skipping validation after seeing an evidence ID.

Before enqueue, the persisted workflow must be `PAUSED` at `wait_for_evidence` in the
same tenant/organization. The actual step handler persists PAUSED; a superficially
similar RUNNING executor return value is not the database park state. Execution errors,
lookup errors and timeout now deny enqueue. Static review of these repairs passed.

The focused EXEC regression suite passed **11/11** with the real capability issuer
and UUID validator, and mocked workflow/queue/command-bus boundaries. Source hashes
and runner are in `../evidence/exec-integration-regressions.json`. These tests use
transpilation without TypeScript diagnostics; they are not a full package typecheck
or a live worker/recovery proof. The narrow implementation/review loop is closed.

## Remaining integration gaps

- The Cezar result DTO does not match OSS ResultManifest v1; actual snapshot/artifact/check
  mapping is still needed. Type casts do not implement that mapping.
- Automatic WP execution needs the actual baseline snapshot and owned workspace;
  the current execute fallback cannot establish them.
- An unsuccessful park leaves a reserved/linked attempt for reconciliation. These
  repairs do not implement automatic retry or prove recovery.
- A complete newly integrated app build, HTTP/browser E2E and manual acceptance remain
  separate checks. No old-build or unit proof is promoted to those statuses.

No new public API, migration, external upload or workflow state machine was introduced
by this narrow repair. Current call sites and owner handoff are in
`../integration-call-sites.md`.

## EXEC-05 update and follow-up review

Main was subsequently advanced to `68361d163`. The five differently implemented QA
suites added upstream coexist with preserved `.qa-regression.spec.ts` local suites.
Repository discovery accepts the suffix; neither suite was overwritten.

The new execution widget incorrectly destructured the zero-argument `useT` hook.
The fix uses the actual returned translator. Independent review checked the hook
implementation and confirmed the correction.

Review of EXEC-006 found a missing cancel version header, reading a command-envelope
version at the wrong depth, runtime skips hiding failed execution, broad 400/422
acceptance in a concurrency check, and a placeholder assertion presented as replay
coverage. The test now sends the current task version, reads `result.taskUpdatedAt`,
requires one 202 and one 409 in both race rounds, and performs an actual same-key
replay with one persisted attempt. No production route or response was changed.
Source review and TypeScript transpilation passed; live execution remains pending.

The entire current `delivery_os` Jest module passed **94 suites / 1800 tests**, zero
pending. Its first attempt mixed two existing React cache instances; explicit private
runner resolution fixed that environment issue without a product-code change. See
`../evidence/current-main-delivery-os-unit.json`; this is not a full app or HTTP gate.
