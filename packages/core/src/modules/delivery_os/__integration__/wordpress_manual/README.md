# Manual WordPress → OSS technical roundtrip

This opt-in test creates its own API project, baseline, task and scoped Studio site.
It captures a real initial screenshot as a technical baseline reference, then runs
two manual attempts with a correction request between them. Every result uses an
owned capture receipt, frozen database/theme bytes and fresh command reports.
The final assertion is task `verified`, not project publication.

The two acceptance criteria concern a native paragraph with an attempt marker and
PHP syntax. `npx playwright test` reads the frozen theme and runs `php -l`;
`composer run lint` independently runs PHP syntax checks. These are actual command
executions, but they do not prove browser rendering, visual design acceptance,
FLOW stages, worker recovery, automated execution or release readiness.

Prerequisites: an already running disposable OM app and its matching Postgres DB;
Node 24, Studio and PHP/Composer on PATH; a built delivery-wordpress operator
including `capture-owned-snapshot.js`; the existing Tailwind 4.3.3 toolchain; an
existing check toolchain with `node_modules/@playwright/test` and Chromium available
to the outer Playwright runner. No package installation occurs in this scenario.

Set `BASE_URL`, `DATABASE_URL` and the existing `OM_INIT_ADMIN_EMAIL` /
`OM_INIT_ADMIN_PASSWORD` credentials through the private environment. Set
`OM_WP_MANUAL_ROUNDTRIP_CONFIG` to an absolute path to a mode-0600 JSON file:

```json
{
  "operatorRoot": "/private/built-wordpress-operator",
  "sitesRoot": "/private/qa-sites",
  "stateRoot": "/private/qa-state",
  "toolchainRoot": "/private/tailwind-toolchain",
  "checkToolchainRoot": "/private/playwright-toolchain",
  "evidenceRoot": "/private/qa-evidence",
  "disposalPlan": "Operator will explicitly dispose only the site listed in the run ledger after inspecting cleanup.json."
}
```

All directories must exist without symlink components. Sites, state and evidence
roots must be private (mode 0700). Do not reuse a prior project/site request.
Keep raw reports and screenshots private; they may contain local filesystem paths.

Use the repository's configured runner/environment. Scope discovery first, then run
with no retries and enough time for native operator calls. Use a fresh private
`QA_OUTPUT` directory; `--reporter=line` avoids overwriting the shared HTML report:

```sh
OM_INTEGRATION_MODULES=delivery_os npx playwright test \
  --config .ai/qa/tests/playwright.config.ts TC-DELIVERY-WP-MANUAL-001 --list
OM_INTEGRATION_MODULES=delivery_os npx playwright test \
  --config .ai/qa/tests/playwright.config.ts TC-DELIVERY-WP-MANUAL-001 \
  --workers=1 --retries=0 --timeout=1800000 --reporter=line --output="$QA_OUTPUT"
```

Absent opt-in configuration means `not_run`. Configuration errors or failed checks
fail the test; they do not become runtime skips. Real command output, definition
bytes, packages, receipts, manifests and per-attempt API outcomes are retained under
the new private run directory. A wrong-marker negative check is available by running
the frozen check helper against a fixture with a different marker; it must reject.

Cleanup closes the browser, waits for owned operations, stops the site and removes
only project-scoped delivery rows after an exact ID/scope/name database sentinel.
The attachment is removed only after successful project cleanup. Audit history and
the stopped owned site remain for explicit environment disposal; `ledger.json` and
`cleanup.json` identify them. Stop/cleanup errors fail the test and require inspection
before retry. Never clear a retained operation lock to force cleanup.

Authored and checked offline; an end-to-end live PASS must come from executing this
scenario on the transferred environment. Unit/fixture checks are not that evidence.
