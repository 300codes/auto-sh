<!-- IMPL-REVIEW-REPORT -->
# Safety and patterns review — WordPress demo foundation

Date: 2026-09-19. Reviewer: independent safety subagent. Plan: `../plan.md`.
Reviewed: `demo-probe.ts`, `demo-native.ts`, corresponding tests, and integration with
`demo-plugins.ts`, existing `tools.ts`, ownership/path/runner helpers. This reviewer
implemented the plugin helper; the caller and native probe are independently reviewed.
No live commands were executed for this review. Live validation and final package gate
remain separately owned evidence; this report is not an editor or publication PASS.

## Finding S1 — restart a retained stopped site on operator retry

Severity: WARNING / reliability. File: `packages/delivery-wordpress/src/demo-probe.ts`,
`runDemoProbe`, immediately after `tools.createSite(request)`.

A successful probe stops its site in finally. Calling the probe again with the identical
request makes `createSite` replay the stored ready result; that existing branch checks
inventory but does not start a stopped site. The operator caller does not start it either.
Snapshot preserves the previous running state, so the later HTTP probe has no guarantee
of a running server. Incidental startup by a WP-CLI subprocess is not the tools contract.

Recommendation: after successful owned create/replay, explicitly call `tools.start`
before plugin/native/snapshot/HTTP work. Keep finally stop. Add a caller test modelling
an already-stopped owned site and verify start precedes probes. No change to public
createSite semantics is needed. Resolution: owner added explicit `site.start` stage after create. Caller test fixture reports a stopped site and now asserts start before all probes; seven stage checks are recorded. Focused caller suite rerun by this reviewer: 6/6 PASS (`node --test --test-isolation=none packages/delivery-wordpress/src/__tests__/demo-probe.test.ts`).

## Checked boundaries

- Shell execution remains argument-array `execFile`, no arbitrary operator-supplied
  command text or model scope. Plugin IDs are the three fixed slugs.
- Plugin provisioning validates all archive hashes/size/privacy before mutations;
  reads bounded file descriptors, stages the verified bytes privately outside the served
  tree and removes staging in finally. Original archive changes after verification do
  not alter installed bytes. Errors and reports omit private paths/content.
- Both plugin and native mutations revalidate ownership/Studio registration under the
  existing operation lock. Unknown mutation outcomes retain a reconciliation lock.
- Native probe edits only its random-marker draft and own metadata. It verifies numeric
  ID plus marker/title/status before deletion; changed ownership fails closed. Failed
  cleanup is reported and cannot become overall success. A replay that retains its lock
  can prevent post cleanup/site stop; that is explicitly a reconciliation failure.
- Metadata roundtrip is generic WordPress post meta, not evidence of ACF/Yoast browser
  editability. Reports keep browser editor, redeploy, approved design/Tailwind, OM flow
  and public Studio Preview outside completed acceptance. Translations are deferred.
- Caller rejects unknown config before create, records omitted stages as not_run, catches
  failures with safe codes and attempts stop only after create returned an owned result.
  If create partially mutates then throws, no unsupported claim of successful stop occurs.
- Public exports and existing tools v1 stay unchanged; internal operator modules follow
  existing Zod, path checks, owned handles, bounded runner and node:test patterns.

## Observations / evidence limits

- Reconciliation reports can say cleanup failed without exposing the private draft marker
  or numeric post ID. Persisting those nonsecret identifiers in a private operator journal
  would make later manual cleanup easier; not a release blocker for this bounded probe.
- Plugin activation/noindex and generic native content/meta persistence are partial F0
  readiness. They do not establish full plugin configuration, ACF field UX, SEO output,
  editor capabilities, client approval, redeploy preservation or public availability.
- Focused plugin tests were run earlier: 14/14 passed using Node 24 with
  `--test-isolation=none`. Root reports package typecheck/build subsequently passed after
  local type roots were corrected. Final combined gate/live outcome must be linked by owner.

Final code-review verdict: APPROVED after S1 fix; no unresolved blocking safety findings. Live plugin installation currently has a separately reported COMMAND_FAILED blocker with retained lock and refused stop; approval of code safety does not mark that live readiness or cleanup successful.


## Transport follow-up

The initial plugin review above described private disk staging. Subsequent live execution
proved Studio sandbox cannot see that external path. The user-authorized adaptation now
serves frozen verified bytes through a temporary loopback-only HTTP endpoint, without
copying the paid archive into the served WordPress tree. This reviewer implemented that
delta, so the earlier independent caller/native approval does not independently approve
the new transport. Independent review of the transport belongs to the other reviewer.

Focused transport/helper gate: 15/15 synthetic tests PASS with loopback-listener permission;
package typecheck and build PASS. Tests cover unknown path/method rejection, bounded GET
retry count, closed listeners after success/failure/deadline, retained uncertainty lock,
real fetched bytes hashes and preflight tampering. No live invocation was made by this
reviewer. WordPress safe-URL handling may reject loopback URLs and remains a measured live
compatibility question; no broad HTTP safety bypass was introduced.
