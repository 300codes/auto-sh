<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: QA + WordPress delivery sequence

- **Plan**: `context/changes/qa-wp-delivery-sequencing/plan.md`
- **Scope**: Phase 2, completed criterion **2.2 only** — W1 asset enqueue, W2 controlled theme.json application and their preparation coordinator. Phase 2 as a whole remains incomplete.
- **Date**: 2026-09-19
- **Verdict**: **APPROVED for criterion 2.2; Phase 2 acceptance pending**
- **Findings**: 0 critical, 1 acceptance warning, 0 newly found implementation blockers
- **Review mode**: Independent read-only integration and plan-adherence review, consolidating the separate W1/coordinator safety and W2 reviews. No runtime, compiler or additional test process started by this reviewer.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS — implementation of 2.2 matches the single-lock coordinator plan |
| Scope Discipline | PASS — internal operators; no createSite v1/API/snapshot semantic change |
| Safety & Quality | PASS for reviewed implementation |
| Architecture | PASS — owner scope, shared lock and bounded local mutation |
| Pattern Consistency | PASS — shared tools/status, paths, ownership and safe error patterns |
| Success Criteria | WARNING — 2.2 passed; 2.1 HTTP and 2.3 browser/snapshot acceptance remain unchecked |

## Findings

### F1 — Phase 2 has outstanding live acceptance checks

- **Severity**: WARNING
- **Impact**: MEDIUM — separate runtime windows and actual evidence required
- **Dimension**: Success Criteria
- **Location**: `plan.md`, Progress 2.1 and 2.3
- **Detail**: The current evidence establishes the local implementation and package checks, not current-main OSS HTTP regression or rendered frontend/editor CSS. `local-prepared-theme.json` explicitly records `browserFrontend: not_run`, `browserEditor: not_run`, fixture design provenance and `approvalVerification: not_evaluated`. Its real local compiler output is 92 bytes; that fact does not establish visible utilities or editor iframe styling. A historical HTTP pass does not validate the present dirty source revision. Both remaining criteria are correctly unchecked.
- **Fix**: Preserve the unchecked criteria. Run 2.1 against the current isolated source/environment with API-to-DB sentinel and cleanup evidence; run 2.3 with a browser-observed frontend/editor style and snapshot hash from the same completed local build. Treat full-system gate and real design approval as separate gates.
  - Strength: Keeps each acceptance claim tied to its actual execution and source identity.
  - Tradeoff: Requires the root-coordinated resource windows and browser evidence.
  - Confidence: HIGH — explicitly reported limitations and current Progress agree.
  - Blind spot: This review performs no live run.
- **Decision**: PENDING VERIFICATION — not a blocker to accepting the completed 2.2 implementation; blocks claiming all of Phase 2 complete.

## Plan-to-code verification

| Planned work | Reviewed implementation | Verdict |
|---|---|---|
| W1 managed include and native frontend/editor enqueue | `theme-assets.ts`: fixed include after PHP opening line; owned `inc/assets.php`; native `enqueue_block_assets`; runtime CSS SHA-256 URL version; no CDN or Preflight | MATCH; rendering remains separately unverified |
| W1 expected hashes and preserve user files | Strict initial and final file hashes, collision refusal, private before-image journal, bounded atomic write; `inc/setup.php` and database untouched | MATCH |
| W2 managed preset namespaces | `theme-design-apply.ts`: validated mapper output, version 3 theme JSON, only previously journal-owned presets replaced; foreign slug collision refused | MATCH |
| W2 preserve styles/settings/DB | Merge spreads unrelated top-level/settings keys, preserves all styles; modified managed entries conflict; no database call | MATCH |
| One coordinator lock | `prepare-theme.ts`: one `withSiteLock` across preflight, design apply, enqueue, real build and final byte verification; WithinLock primitives validate lock and owner registration | MATCH |
| Failure and reconciliation | Private step journal and before-images; failure retains operation.lock; actual snapshot entrypoint test refuses partial preparation; no automatic rollback of DB or lock stealing | MATCH |
| Standalone builder compatibility | `buildOwnedTheme` retains wrapper-owned lock; internal `buildThemeWithinLock` supplies composition; no public index export added | MATCH |
| Real callsite, replay and negative coverage | Compiled CLI local preparation evidence; real compiler coordinator test; replay/content preservation, stale preconditions and timeout-after-apply denial of snapshot | MATCH |

WithinLock functions are trusted internal composition primitives. Checking the lock directory is not a new external authorization mechanism; callers remain responsible for acquiring it through the existing coordinator/wrappers. No external route exposing those primitives was introduced.

## Closed findings verified

The independent [`w1-coordinator-safety-review.md`](w1-coordinator-safety-review.md) documented five fixes. Current source and tests retain them:

1. The include is inserted immediately after the PHP opening line, so an early return or appended comment cannot silently disable it. Unsupported namespace/declare input is refused; replay requires the exact prefix and a single occurrence.
2. Unchanged asset replay rechecks both final file hashes before reporting success.
3. Journal reads use the larger 1 MiB bound, allowing the base64 before-image of the accepted source size; large-source replay regression remains present.
4. Coordinator verification compares theme.json, functions.php, assets.php and compiled CSS against returned hashes.
5. Temporary journal files are removed in finally; the outer callable boundary maps failures to safe error codes.

The independent [`w2-review.md`](w2-review.md) covers controlled JSON ownership and preservation plus a coordinator/builder plan-adherence addendum. Current code also refreshes the design journal's full afterHash on acknowledged unrelated edits, preserving theme-update consistency without discarding those edits. No unresolved warning from those implementation reviews was found.

## Verification evidence and identity

- [`../evidence/final-package-gate.json`](../evidence/final-package-gate.json): local Node v24.13.1 package runner, **184/184 tests passed**, zero failures/skips, typecheck and build passed; no services started; no source changes during that gate. This is a package gate, not the monorepo ordered gate.
- Reviewer independently compared current hashes against that gate for all four reviewed implementation files, design-tokens.ts, their four test files, and the public index/contracts/scaffold/snapshot surfaces: **13/13 match**. The saved HEAD alone is insufficient; the gate's source hashes include dirty working-tree changes.
- [`../evidence/local-prepared-theme.json`](../evidence/local-prepared-theme.json): the compiled operator applied fixture design, installed the enqueue bootstrap and ran real Tailwind on the owned local stopped site. It records component, output and compiled-source hashes. This remains historical local preparation evidence and does not imply current browser state or publication.
- `prepare-theme.test.ts` exercises replay through the actual compiler, preservation of theme styles and a DB surrogate, stale precondition before mutation, and snapshot/retry refusal after a partial failure. A surrogate proves the operator did not mutate that fixture file; real editor retention belongs to Phase 3.

No test was rerun unnecessarily during this read-only review. Root owns the current gate and runtime coordination. The reviewer only writes this report; change.md lifecycle stamping remains with the root integrator.

## 2026-09-19 — poprawka konfiguracji danych logowania QA

Aktualne testy z main zakładały domyślne admin/employee, mimo że initialize utworzył
prywatne dane logowania. Helper integration/auth.ts teraz odczytuje istniejące
OM_INIT_ADMIN_EMAIL/PASSWORD i OM_INIT_EMPLOYEE_EMAIL/PASSWORD tak samo jak
superadmin, zachowując kompatybilny fallback. Brak zmian produkcyjnego auth lub
osłabienia kont. Hermetyczna regresja: przed2 FAIL/1 PASS, po3/3 PASS; root
source review APPROVED. Dowód: ../evidence/qa-auth-helper-fix.json.
Powtórzenie dotkniętych HTTP ma osobny raport; unit PASS nie zalicza2.1.
