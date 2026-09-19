<!-- IMPL-REVIEW-REPORT -->
# Implementation review: WordPress demo foundation — plan adherence

- Plan: [F0 execution plan](../plan.md)
- Scope: phases 1–3 implementation in progress; independent plan adherence, scope and success-criteria review. Not acceptance of the later WordPress demo.
- Date: 2026-09-19
- Reviewer: independent plan-adherence agent
- Verdict: implementation scope APPROVED; final verification pending parent evidence export.
- Findings: 0 critical, 0 warnings, 1 observation.

## Verdicts

| Dimension | Verdict |
|---|---|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Success Criteria | PENDING — package gates/live documentation still being produced |

Safety/pattern dimension belongs to the separate independent review. This report does not stamp the whole change complete.

## Implementation mapping

| Planned item | Actual implementation | Verdict |
|---|---|---|
| Scoped pinned provisioning | `demo-plugins.ts` checks ownership and Studio registration, all three archive hashes/permissions/size before mutation, rereads under the existing operation lock, installs only absent plugins and activates only inactive matching versions. | MATCH |
| Idempotent replay | Matching active plugin is unchanged; mismatched version stops. `blog_public` is set to zero only when needed. Caller rejects any replay action other than unchanged or a replay noindex write. No deletion/reset/update-force path. | MATCH |
| Ambiguous mutation | Existing `withSiteLock` retains its lock on thrown mutation failure; subsequent provisioning cannot blindly retry. Temporary verified archives are removed in finally. | MATCH |
| Operator caller | `demo-probe.ts` calls the existing tools, plugin preparation, native edit/replay, snapshot, local HTTP and owned-site stop in finally. Create failure is reported blocked/reconciliation-required without guessing which site can safely be stopped. | MATCH |
| Native edit probe | `demo-native.ts` is a justified extraction of the planned caller responsibility. Draft marker/title/status and returned ID are verified before update/deletion; own post/meta readback and noindex are checked across replay. Cleanup failures remain failed/reconciliation-required. | MATCH |
| Public contracts | Existing package exports, createSite v1 and production dependencies are unchanged. `tsconfig.json` adds local/root Node type roots; no public API change. | MATCH |
| Reporting boundaries | Report says standalone_tools, OM not_connected, AC not_evaluated, preview not_published and translations deferred. Redeploy explicitly remains not_run. No editor/browser, design, Tailwind or final WordPress acceptance is claimed. | MATCH |

## Findings

### F1 — Final success evidence is still in progress

- Severity: OBSERVATION
- Impact: LOW — quick decision; narrowly scoped documentation/gate completion.
- Dimension: Success Criteria
- Location: `context/changes/wordpress-demo-foundation/plan.md` Progress; README/spec/operator evidence pending at review time.
- Detail: All Progress rows remain unchecked, correctly avoiding premature completion. The environment agent reports nine focused native tests passed and is extending failure coverage; the parent owns full package test/typecheck/build, compiled caller/live run, final source manifest, budget and documentation. This reviewer has inspected source/tests but has not independently rerun the same toolchain concurrently.
- Fix: Before final handoff, link actual final gate and live-or-measured-blocker reports, source hashes, owned-site stop outcome, README/spec operator boundary and charged budget. Preserve downstream not_run/deferred distinctions.
- Decision: PENDING parent evidence export; not an implementation blocker.

## Evidence assessed

Reviewed `demo-plugins.ts`, `demo-native.ts`, `demo-probe.ts`, plugin/caller/native tests, package metadata, tsconfig delta and the existing ownership, status/stop, snapshot and CLI reporting helpers. Plugin tests cover preflight rejection with zero mutations, pinned replay, foreign scope/registration, symlinks, bad hashes and retained uncertain lock. Caller tests cover sequence, failure cleanup, report provenance, replay changes and unknown config. Native tests cover actual lock separation, content/meta/noindex persistence, scoped cleanup and conservative ambiguity handling.

No full-root build, live browser editor or complete OM→WP→OM validation is inferred from these focused checks. The planned six-hour shared WP budget remains a parent handoff requirement.

## Evidence addendum — 2026-09-19

Independent follow-up reviewer: QA/research agent. F1 is **CLOSED for the bounded F0 scope** after reading `evidence/README.md`, `evidence/package-gate.json` and `evidence/live-readiness.json`. Recomputed all 26 recorded source SHA-256 values against the workspace: zero mismatches. New WP-01/WP-02 files are outside that historical manifest and are not covered by its gate.

The recorded local gate passed 65/65 tests, typecheck and build. It explicitly records the actual local compiler/toolchain and that the full declared workspace installation and full monorepo gate were not completed. This reviewer verified the evidence and hashes without rerunning or claiming independent observation of the live operation.

The successful report binds the owned site and creation attempt to a captured theme/database snapshot. It records WordPress 7.1.1/PHP 8.4.23, three pinned active plugins, unchanged replay, noindex, native content/meta persistence, owned draft cleanup, local HTTP 200 and site stop. Both earlier blocked attempts and their scoped reconciliations remain separate evidence. The final transport uses transient verified bytes rather than the earlier temporary archive-path approach described in the initial implementation table.

Success Criteria for this bounded F0 evidence are now **PASS**. This does not establish ACF field/editor coverage, complete SEO/plugin configuration, license activation, design fidelity, Tailwind integration, real redeploy or OM roundtrip. Native metadata is not an ACF proof. The report correctly retains `acceptanceCriteria: not_evaluated`, `preview: not_published`, redeploy `not_run` and translations `deferred_by_user`. All work represented here was local; future Preview publication must use a separately approved completed snapshot and read-only verification.
