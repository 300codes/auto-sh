# WordPress Studio tools — readiness and handoff

Status: **local tools and live scenario verified; OM integration and human acceptance pending**, 2026-09-19. This filename is retained for the parent WP workstream; “reuse” means tool capabilities, not the old orchestration runtime.

The user authorized a standalone private `delivery-wordpress` package, a completely new local Studio site and independent validation within a total six-hour budget including analysis/review. This does not guarantee completion of the later WP PoC. Detailed work: [plan](../../context/changes/wordpress-studio-tools/plan.md), [spec](../../.ai/specs/2026-09-19-wordpress-studio-tools.md), [usage and synthetic request](../../packages/delivery-wordpress/README.md).

## Readiness

| Check | Recorded state |
|---|---|
| Node | 24.13.1 available |
| Studio CLI | 1.19 available |
| Studio auth status | Probe passed; no account identifiers or credentials recorded |
| Old orchestrator | Not a dependency; its API, sessions, database, queue and projects are excluded |
| Target | New dedicated local site; no adoption of existing sites |
| Public preview | Outside current scope; not created or verified by this work |
| Local toolchain | Zod 4.4.3, TypeScript 5.9.3, Node types 25.9.2 through an ignored dependency symlink |
| Root installation/gate | Incomplete dependency installation; full root gate not claimed |

The implementation needs Studio/Git subprocess access, writes to approved new sites/state roots and loopback HTTP. No old runtime login is required. No public server, paid inference or database migration is part of this scope.

## Delivery boundary

The package exposes create/status/start/stop/captureSnapshot. Its compiled caller invokes create plus snapshot and local HTTP smoke. Scope and ownership are validated, subprocesses have bounded output/time, and incomplete create operations require reconciliation rather than blind retry. New sites and snapshots are private operator artifacts; raw databases and absolute account paths must not enter committed evidence.

Future delivery_os/delivery_agents wiring must supply authenticated scope, reserve and correlate attempts/baselines, authorize mutations and map the result into the shared DTO. These call sites are not implemented by the standalone tool. Fixture, a new local site and successful package tests do not mark OM→WP E2E, parent Progress 5.3/5.5 or release acceptance complete.

## Evidence register

| Evidence | State |
|---|---|
| Package tests/typecheck/build | PASS: 29/29 native tests; typecheck, build and compiled import passed |
| Compiled CLI create/activation | PASS, fresh Open Mercato Studio site, om-studio theme |
| Local HTTP smoke | PASS, HTTP 200, 28422 bytes; no visual/mobile claim |
| Idempotent replay | PASS; identical siteId, Studio ID, creation toolExecutionId and theme commit across repetitions; no second site |
| Theme commit and snapshot hashes | Real values in [live evidence](adapters/wordpress/evidence/local-studio.live.json); 10 theme files and SQLite backup hashed |
| Independence | Fake-tool flow passes with all HTTP denied; live caller has no old-server configuration. Old server still reachable and was not interrupted |
| Implementation review | APPROVED with pending human acceptance; [review](../../context/changes/wordpress-studio-tools/reviews/impl-review.md) |
| Human viewing/acceptance | Pending |
| OM→WP→OM PoC | Not implemented; dependent integration later |

Live evidence must record timestamp, tool/check IDs, actual hashes, safe correlation IDs, and passed/failed/not_run outcomes. Synthetic fixtures remain labelled fixture and never fill a missing live row. Public preview remains not_run unless separately authorized and verified.

## Time and continuation

Total budget: **6 hours across all WP work**, including preceding analysis, documentation and review. Conservative accounting window: 2026-09-18 22:00–23:06 UTC (about 66 minutes, including prior analysis, review and live diagnostics). The six-hour ceiling was not reached; no remaining independent requirement justifies consuming the reserve. On exhaustion, record achieved results and blockers rather than expanding scope or claiming the whole WP package complete.

## Delivered result and operator notes

Local site: [Open Mercato Studio](http://localhost:8884). Demo scope IDs are standalone
correlation values, not pre-existing OM tenant/project records. The retained site is
new; no existing project was adopted. Start/stop is available through the package API
with the scope/siteId in the evidence and the same trusted roots used for creation.

The initial live trials completed creation/snapshot but failed the first HTTP probe
with 302 after restart. A read-only diagnostic confirmed a redirect to the same homepage;
readiness now retries only an exactly identical URL and never follows another Location.
The final compiled CLI scenario passed after that fix. Earlier failures were not rewritten
as successes. Fixture examples are separately labelled and have no accepted baseline/AC.

Validation runner: local. Commands: `npm run typecheck`, `npm run build`, `npm test`,
compiled `dist/index.js` import, `git diff --check`, lessons catalog checker. PASS.
`yarn install --mode=update-lockfile` with declared Yarn 4.17.1 generated only the
new workspace record; existing peer warnings remain. An earlier attempt with cached
Yarn 4.12 failed on TypeScript patching and made no lock change. Native subprocess
tests require execution outside this sandbox, which otherwise suppresses child stdout.
No full monorepo build/lint/test claim: root dependencies are not fully installed.

The code, docs and review are retained on local branch `feat/wp-m01-studio-tools`;
no remote publication, PR or merge was performed. The generated theme has its own Git
baseline shown in evidence. Ignored toolchain links/dist and private Studio/state files
are excluded from repository changes.

Remaining integration: authenticated backend scope and mutation approval, domain
attempt/baseline reservation and result mapping, enterprise lifecycle caller, and
scoped OM→WP→OM E2E tests once delivery_os/delivery_agents exist. No additional access
is needed for the delivered local scope. Public preview and human visual acceptance
remain unperformed and are not claimed.
