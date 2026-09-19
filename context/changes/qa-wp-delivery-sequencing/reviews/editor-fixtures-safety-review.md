<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: editor fixtures after host shutdown

- **Plan**: `context/changes/qa-wp-delivery-sequencing/plan.md`
- **Scope**: Phase 3 fixture preparation, safety and plan adherence; not full Phase 3 acceptance
- **Date**: 2026-09-19
- **Verdict**: APPROVED — fixture implementation scope
- **Findings**: 0 open critical, 0 open warnings, 1 observation; F1 fixed
- **Method**: Independent read-only review. No services, tests, database mutation or browser session started by this reviewer. Parent coordinates the package gate.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS for fixture preparation; browser and redeploy acceptance pending |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | Focused fixture gate PASS (15/15, parent execution); full 3.1–3.3 pending |

## Findings

### F1 — ACF field cleanup can cascade outside the fixture journal

- **Severity**: WARNING
- **Impact**: LOW — narrow guard and regression test
- **Dimension**: Safety & Quality
- **Location**: `packages/delivery-wordpress/src/editor-fixtures.ts`, PHP delete branch for `kind === 'field'`
- **Detail**: Field ownership validation checks post name and parent, then invokes `acf_delete_field($id)`. The fixture originally creates a text field, but cleanup does not verify that its definition remains a text field or has no children. If an administrator converts it to group/repeater and adds subfields, ACF's delete hook recursively deletes those unjournaled subfields. Confirmed from the installed ACF implementation: `includes/acf-field-functions.php:1162` dispatches `acf/delete_field`; `includes/fields/class-acf-field-group.php:591` deletes each subfield. The group cleanup already refuses existing child fields; the field branch needs the equivalent boundary.
- **Fix**: Before deleting a field, verify its current type remains `text` and reject any child `acf-field` across all post statuses. Keep the journal and lock on conflict. Add a PHP stub regression asserting that a changed definition or unowned child causes zero `acf_delete_field` calls.
- **Decision**: FIXED — independent re-review confirmed current type must be exactly `text` and no child ACF field may exist in any post status before deletion. Real PHP stub regression checks group/repeater/text-with-child rejection with zero delete invocation, plus the childless text positive case. Parent reports focused 15/15 tests PASS; reviewer did not rerun runtime.

### F2 — Native operator readback is not browser acceptance

- **Severity**: OBSERVATION
- **Impact**: LOW — retain existing evidence boundaries
- **Dimension**: Success Criteria
- **Location**: `readState` and `dependency-gates.md` G2
- **Detail**: Reports correctly expose `browser: not_run`, fixture provenance for injected runners or fixture-owned sites, and `globalStyles: owned_fixture_storage_only`. The dedicated actor has `edit_theme_options` without administrator or plugin/user-management capabilities. Actual editor navigation, persistence, minimal capability approval and CSS/browser proof still require live checks. Do not mark 3.1–3.3 complete based on this operator.
- **Fix**: No source change required; preserve these distinctions when recording the parent gate and subsequent live proof.
- **Decision**: ACCEPTED AS PENDING VERIFICATION

## Verified repairs from the interrupted review

- Embedded PNG now has a CRC regression test across IHDR, IDAT and IEND.
- Failed attachment insertion removes an unattached upload only when it remains a regular non-symlink file with exactly the fixture bytes. Existing attachment or changed bytes retain the file for reconciliation. Real PHP stub coverage includes orphan, attached and changed bytes, plus preservation of an unrelated file.
- Actor deletion counts every post authored by that actor using a parameterized SQL query before invoking `wp_delete_user`, preventing untracked post cascades. Role deletion refuses remaining users.
- Every WP call resolves the scope-owned site through the existing tools/status path. Mutations run under the shared operation lock; uncertain creation keeps the journal and lock. Cleanup never steals a stale lock automatically.
- Reverse-order cleanup deletes recorded fixture resources only, refuses ownership changes, and erases the private password after successful cleanup. The report excludes credentials. Journal writes use private atomic replacement.
- Integration remains an internal CLI/function without changing createSite v1 or public package exports. Pattern comparison used `ownership.ts`, `paths.ts` and existing tool context/scope checks.

## Source identity

- Source SHA-256: `937a488123807a518aa3a6708932e2beb798509636eff8eb2bf02e05f543d19e`
- Tests SHA-256: `aff60f4146a06edeee802ad6350513f83baba8457f906d336ca5f1ef898b46ec`
