# OSS-06 — full capped gate, OSS-only reproduction (T037)

- **Tree:** HEAD `35e77c4dd` on `dev-mateusz` **plus** the uncommitted OSS-06 fix listed below. The orchestrator commits
  the fix after independent review; the committing SHA is the one to quote in the Progress row.
- **Runner:** local (macOS, Node 24.15, yarn 4). No compose `app` container, so not Docker mode.
- **Caps:** one heavy command at a time, foreground; turbo `--concurrency=2` (tests `--concurrency=1`), jest `maxWorkers: 2`
  (`jest.config.base.cjs`), dev server on :3100 stopped before `build:app` and restarted at the end.
- **Logs:** `/tmp/t037/*.log` (local, not committed). Durations are wall clock from `run.sh`.
- **DTO / contract versions touched:** none. Frozen v1 contracts unchanged.

## Gate steps

| # | Command | Duration | Exit | Result |
|---|---|---|---|---|
| 1 | `yarn generate` | 12 s | 0 | PASS. No tracked generated diffs (`git status` clean apart from the fix). Known OpenAPI bundle noise `ERR_IMPORT_ATTRIBUTE_MISSING (language-subtag-registry)` → static fallback, pre-existing on Node 24 |
| 2 | `yarn turbo run build --concurrency=2 --filter=./packages/*` | 13 s | 0 | PASS, 38/38 tasks |
| 3 | `yarn i18n:check-sync` | 1 s | 0 | PASS, 5 locales in sync |
| 4 | `yarn i18n:check-usage` | 115 s | 1 | **FAIL** — 17 missing keys, all `delivery_os.audit.*` (see patch request P2). 7889 unused keys are advisory |
| 5 | `yarn turbo run typecheck --concurrency=2` | 38 s | 0 | PASS, 38/38 tasks |
| 6 | `yarn turbo run lint --concurrency=2 --filter=@open-mercato/core` | 0 s | 0 | **No task executed** — `@open-mercato/core` has no `lint` script. Not a PASS of core lint; see 6b/6c |
| 6b | `yarn turbo run lint --concurrency=2` | 4 s | 0 | PASS — the only package with a lint script (1 task of 42 packages) |
| 6c | `node_modules/.bin/eslint --config eslint.config.mjs packages/core/src/modules/delivery_os` | 3 s | 0 | PASS, 0 findings. (First attempt with `apps/mercato/eslint.config.mjs` exited 2 — wrong config path, not a lint result) |
| 6d | `yarn i18n:check-hardcoded` | 3 s | 0 | Advisory (phase 1). 0 findings in `delivery_os` |
| 7 | `NODE_OPTIONS=--max-old-space-size=1024 yarn turbo run test --concurrency=1 --filter='!open-mercato-docs' --continue` | 431 s | 1 | **FAIL** — 42/45 tasks passed; failing: `@open-mercato/core` (3 suites / 4 tests), `@open-mercato/cli` (1 test), `create-mercato-app` (2 tests). Breakdown below |
| 7b | `yarn workspace @open-mercato/core jest src/modules/delivery_os src/__tests__/explicit-sort-comparators.test.ts src/__tests__/module-decoupling.test.ts src/__tests__/optimistic-lock-editable-entities.test.ts --maxWorkers=2` (after fix F1) | 5 s | 0 | PASS — 56 suites, 1357 tests (includes module-decoupling and optimistic-lock-editable-entities) |
| 5b | `yarn turbo run typecheck --concurrency=2 --filter=@open-mercato/core` (after fix F1) | 3 s | 0 | PASS |
| 6e | eslint on `delivery_os` (after fix F1) | 3 s | 0 | PASS |
| 8 | `yarn build:app` (first attempt) | 27 s | killed | **Not a result** — the agent session was interrupted and turbo force-killed the task |
| 8a | `yarn turbo run build --concurrency=2 --filter=@open-mercato/core` (dist with fix F1) | 7 s | 0 | PASS |
| 8b | `yarn build:app` | 131 s | 0 | PASS — Next.js 16.3.3 production build complete |
| — | `open-mercato-docs` test (Docusaurus site build) | — | — | **Not run** — it is a full docs site build, not a unit suite; excluded to respect the RAM rule |
| — | Playwright integration (`yarn test:integration`) | — | — | **Not run** — not part of this gate list; QA-owned |

### Step 7 failure breakdown

| Suite | Owner | Cause | Action |
|---|---|---|---|
| `core: src/__tests__/explicit-sort-comparators.test.ts` | **OSS** | `delivery_os/lib/hash.ts:37` and `lib/evidenceRules.ts:41` called `.sort()` without a comparator | **Fixed (F1)**, green in 7b |
| `core: src/modules/auth/__tests__/acl-feature-catalog.i18n.test.ts` | auth i18n catalogue (not OSS) | 8 `delivery_os` ACL features have no `auth.acl.features.delivery_os.*` titles in `auth/i18n/en.json` | Patch request **P1** |
| `core: src/modules/warranty_claims/__tests__/quantity.test.ts` (2 tests) | warranty_claims (not OSS) | Locale-dependent: machine locale formats `2.5` as `2,5` (`Expected "2.5", Received "2,5"`) | Environment/upstream, not delivery_os. Recorded only |
| `cli: src/lib/generators/__tests__/module-facts.bc-guard.test.ts` | UI stream (host source page) | `delivery_os.projectExecution` → `reason: "unbound-declaration"`, `source.path: "backend/delivery/projects/[id]/page.tsx"`: the extension host declared in `delivery_os/extension-points.ts` points at the UI-owned page, which does not exist on this branch | Patch request **P3** (not fixed: removing the host would break the frozen widget spot contract `delivery_os.project.execution` / `delivery_os.project.execution.v1`) |
| `create-mercato-app: template-modules-parity.test.ts` | create-app template (not OSS) | `apps/mercato/src/modules.ts` has `{ id: 'delivery_os', from: '@open-mercato/core' }` (OSS-02 registration); `packages/create-app/template/src/modules.ts` does not — "run `yarn template:sync:fix`" | Patch request **P4** |
| `create-mercato-app: release-upgrade-skill-contract.test.ts` | release/changelog (not OSS) | `Expected '2026-09-18', actual '2026-09-17'` — changelog upgrade window date | Not delivery_os. Recorded only |

## Fixes in delivery_os (feature freeze: no behaviour or contract change)

- **F1** `packages/core/src/modules/delivery_os/lib/hash.ts` — new exported `compareCodeUnits(left, right)`; canonical key
  sort uses it. `lib/evidenceRules.ts` `normalizeAttachmentIds` uses it. The comparator reproduces the default
  `Array.prototype.sort` order for strings (UTF-16 code units), so **every stored hash stays identical**; the tests
  `lib/__tests__/hash.test.ts` (code-unit order incl. `ä`, `é`, digits, `_`) and `lib/__tests__/evidenceRules.test.ts`
  (lowercase, dedupe, sort) pin it.

## OSS-only reproduction

| # | Command / check | Duration | Exit | Result |
|---|---|---|---|---|
| 9 | `OM_ENABLE_ENTERPRISE_MODULES=false OM_ENABLE_ENTERPRISE_MODULES_{SSO,SECURITY,AGENTS}=false yarn generate` | 12 s | 0 | PASS |
| 10 | same env, `yarn turbo run build --concurrency=2 --filter=@open-mercato/core` | 0 s (turbo cache hit of 8a, same inputs) | 0 | PASS |
| 11 | Registry `apps/mercato/.mercato/generated/enabled-module-ids.generated.ts` | — | — | PASS — `delivery_os` 1; `record_locks`, `system_status_overlays`, `sso`, `security`, `agent_orchestrator`, `agent_examples` 0 each; 0 generated files reference `@open-mercato/enterprise`; `modules.generated.ts` has 40 `delivery_os` refs |
| 12 | Import grep in `packages/core/src/modules/delivery_os` (non-test `from`/`import(`/`require(` of `@open-mercato/enterprise`, `../enterprise/`, `delivery-cezar`) | — | — | PASS — 0 matches; `packages/core/package.json` has no enterprise/delivery-cezar dependency. Only matches overall are the guard regex literals in `__tests__/enterpriseBoundary.ts` and `module-registration.test.ts` |
| 13 | `module-decoupling.test.ts` | in 7b | 0 | PASS |

The dev server's `.env` already sets all enterprise flags false, so the OSS-only build is also the dev server's normal build;
no separate enterprise-on rebuild was needed to restore it.

## Dev server restore

- Restarted `OM_DEV_AUTO_OPEN=0 PORT=3100 yarn dev` (log `/tmp/omhack-dev.log`) and left it running as shared infrastructure.
- `curl http://localhost:3100/login` → **200**; `POST /api/auth/login` (admin@acme.com) then `GET /api/delivery_os/projects?pageSize=5` → **200**.

## Patch requests (outside OSS ownership — exact output above, not fixed here)

- **P1 (auth i18n owner)** — add to `packages/core/src/modules/auth/i18n/{en,pl,es,de,ko}.json` (en values must equal the `acl.ts` titles):
  `auth.acl.features.delivery_os.projects.view` "View delivery projects", `.projects.manage` "Manage delivery projects and tasks",
  `.baselines.approve` "Approve delivery requirements and design", `.results.import` "Import delivery results and evidence",
  `.attempts.manage` "Reserve, cancel and export execution attempts", `.attempts.reconcile` "Reconcile execution attempts",
  `.deploy.approve` "Approve delivery publication", `.release.approve` "Accept delivery releases".
- **P2 (UI stream — `delivery_os/i18n/**`)** — add the audit action labels used by the commands:
  `delivery_os.audit.{projects.create,projects.update,projects.delete,tasks.create,tasks.update,tasks.delete,tasks.import_plan,baselines.create,baselines.import_requirements,decisions.record,decisions.deploy,decisions.release,attempts.reserve,attempts.cancel,attempts.reconcile,results.accept,evidence.record}`
  in all 5 locales (keeps `i18n:check-sync` green).
- **P3 (UI stream)** — the page `packages/core/src/modules/delivery_os/backend/delivery/projects/[id]/page.tsx` must exist and bind
  `extensionPoints.hosts.projectExecution` (spot `delivery_os.project.execution`). Expected to resolve when the UI branch is merged;
  re-run `yarn workspace @open-mercato/cli jest src/lib/generators/__tests__/module-facts.bc-guard.test.ts --maxWorkers=2` after merge.
- **P4 (create-app template owner / maintainers)** — decide whether `delivery_os` ships in the scaffold template. Either run
  `yarn template:sync:fix` (adds the `delivery_os` line to `packages/create-app/template/src/modules.ts`; check
  `agent-instruction-budget.test.ts` headroom) or exclude it in the template transform.

## Progress rows with evidence (acceptance stays with a human)

- 6.1 — OSS gate evidence with runner recorded (this file); gate is **not fully green**: steps 4 and 7 fail on P1–P4 and two
  non-delivery_os environment/upstream tests.
- 6.2 — OSS-only reproduction green (steps 9–13).
