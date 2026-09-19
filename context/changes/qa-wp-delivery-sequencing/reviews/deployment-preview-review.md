# Independent deployment / Preview review

Verdict: APPROVED for the implemented preparation scope. No unresolved blocker found in the reviewed implementation. Actual publication, host configuration substitution, secret/license/content approvals and browser acceptance remain unexecuted gates.

Reviewed `deployment-manifest.ts`, its focused tests, `preview.ts`, its tests, and the latest `theme-design-apply.ts` journal refresh. Read-only review; no production changes by this reviewer. Validation results are owner/root gate evidence, not rerun by this reviewer.

## Plan adherence and safety

- Capture uses the same ownership checks and operation lock as existing tools, requires the registered site to remain stopped, and takes a SQLite backup instead of copying a potentially live WAL-dependent database. Source inventory is rehashed; every staged file is verified against its manifest. Own-theme presence and database are required. Partial capture cleans only its newly allocated private package; cleanup failure is explicit and retains reconciliation lock.
- This separate deployment manifest preserves plugin/mu-plugin/media/drop-in dependencies and runtime filenames such as `tokens.php`, nested SQL, vendor and node_modules; it does not reinterpret the frozen v1 snapshot contract. Ambiguous runtime/media archives and private-key extensions block instead of silently yielding a complete claim. Operational exclusions are enumerated. Database secrets and licensing are explicitly not evaluated. Runtime identity is operator-declared, not observed or attested.
- Capture reports `captured_inventory_only` and `upload:not_run`. Thus a successful private capture cannot stand in for a verified remote site. WordPress core and wp-config are deliberately outside the staged package and require an explicit host integration/configuration gate.
- Preview inspection scopes account-wide CLI listing to the exact owned Studio ID; it rejects ambiguity, invalid host forms, saved-host mismatch, invalid/future timestamps and unsupported CLI version. Commands are read-only and output does not expose account credentials.
- The pure transition helper forbids a second create after uncertain upload, binds begin to the exact package/host approvals, and requires both observed host and matching package hash before verified. It neither uploads nor independently proves approval, site ownership or remote bytes; those are obligations of the future effectful caller. Current report accurately marks the frozen-package upload/configuration seams unresolved.
- W2 refresh of an applied design journal after preserving unrelated theme.json edits is sound: the same managed preset validation remains in place, refreshed afterHash describes the preserved actual file, and final byte verification precedes success. This prevents correct redeploy design binding from spuriously rejecting a successfully reconciled theme.

## Evidence boundaries

Focused tests exercise native SQLite/WAL capture, staged/source mutations, unsafe paths, private mode and cleanup failures; Preview tests exercise isolated read-only CLI fixtures and transitions. They do not prove actual Preview upload, remote host behavior, editor iframe behavior, or production database secret filtering. No change to public exports, createSite v1 or snapshot v1 was found.
