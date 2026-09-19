# OSS-01 — environment readiness (hand-over)

Task: OSS-01 (T001) · Progress row **1.1 (environment part) — evidence only, not ticked** · owner: OSS stream · recorded 2026-09-19 (01:1x–01:2x local, gate logs in UTC below).
Nothing here is a human acceptance; rows 1.1/1.3 of the master plan stay open for the human who records acceptance.

## Facts

| Item | Value |
|------|-------|
| Branch / SHA | `dev-mateusz` @ `38f46e05603e3e2de79a09a6405811fdbd7b2224` (`38f46e056`), working tree clean apart from the two untracked `context/changes/…` folders |
| Node / Yarn | Node `v24.15.0` (nvm), Yarn `4.17.1` (corepack) |
| Runner | **local** — no compose `app` container of this project is running (`docker compose -f docker-compose.fullapp.dev.yml ps --status running -q app` and the `fullapp.yml` variant return nothing; there are no root/`starters` `*dev*.local.yml` app overrides). Only the isolated infra containers below are up. Commands run as plain `yarn X` |
| Ports used by this project | postgres `5442`, redis `6389`, meilisearch `7710` (containers `omhack-postgres`, `omhack-redis`, `omhack-meilisearch`, all `healthy`, restart policy `unless-stopped`); app `3100`, MCP `3001` (dev server, see below) |
| Ports NOT touched | `3000`, `6379`, `7700` (other projects) — never stopped, started or connected to by this task |
| Env files | `apps/mercato/.env` and root `.env` exist and are gitignored (`.gitignore:47`); `docker-compose.*.local.yml` is gitignored (`.gitignore:130`). No compose/env file was created or changed by this task, nothing secret is in git. |
| DB | `open-mercato` on `:5442`, 319 tables in `public` (already migrated/seeded by the operator). `yarn db:migrate` was **not** run by this task. |

## Queue / DB-pool settings (names only)

Observed in `apps/mercato/.env.example`:

| Name | In `.env.example` | Note |
|------|-------------------|------|
| `QUEUE_STRATEGY` | **not set** (only mentioned in a comment, line 213) | `packages/queue/src/factory.ts:62` — anything other than `async` resolves to `local` (file queue in `QUEUE_BASE_DIR=./.mercato/queue`) |
| `REDIS_URL` | commented (`# REDIS_URL=…`, line 40) | the local `apps/mercato/.env` sets it (→ `:6389`); the BullMQ worker runner reads `process.env.REDIS_URL` (`packages/queue/src/worker/runner.ts:141`) |
| `QUEUE_REDIS_URL` | **absent** from `.env.example` and from `packages/queue` source | no separate queue redis URL exists; queue redis = `REDIS_URL` |
| `DB_POOL_MAX` | `20` (line 441) | `apps/mercato/.env` also defines it |
| `OM_WORKERS_DB_CONNECTION_BUDGET` | commented (`#…=20`, line 455) | defaults to `DB_POOL_MAX`; `mercato queue worker --all` fits total per-queue concurrency to it |
| related | `AUTO_SPAWN_WORKERS=true`, `OM_AUTO_SPAWN_WORKERS_LAZY=true`, `OM_AUTO_SPAWN_WORKERS_LAZY_MODE=shared`, `QUEUE_BASE_DIR=./.mercato/queue` | |

Consequence for the H3 gate: unless the local `.env` sets `QUEUE_STRATEGY=async`, workers run as the single-process local strategy —
enough for the manual/fake-executor flow, but **not a proven parallel-worker setup** (master-plan row 1.6, EXEC). Not changed by this task.

## Baseline build and gate (`.ai/agentic.config.json` → `validation.commands`)

Run sequentially by `/tmp/omhack-gate/run-gate.sh` (outside git; logs `/tmp/omhack-gate/step-*.log`, timing `/tmp/omhack-gate/timing.tsv`),
every turbo step with `--concurrency=1`, tests with `--maxWorkers=2` scope, one heavy command at a time (memory rule).

**Baseline build: `yarn build:packages` → exit code `0`, `1 s`** — that figure is a 100 % turbo cache hit (`38 cached, FULL TURBO`), so it is
NOT the real cost. Forced rebuild `yarn build:packages --concurrency=1 --force` → exit `0`, **`70 s`** (real cold cost).

| # | Step | Result | Duration | Notes |
|---|------|--------|----------|-------|
| 1 | `yarn build:packages` | **PASS** exit 0 | 1 s | turbo cache hit |
| 1b | `yarn build:packages --force` (extra) | **PASS** exit 0 | 70 s | honest cold build, 38 packages |
| 2 | `yarn generate` | **PASS** exit 0 | 12 s | git tree unchanged (generated output is gitignored) |
| 3 | `yarn build:packages` (after generate) | **PASS** exit 0 | 0 s | cache hit |
| 4 | `yarn i18n:check-sync` | **PASS** exit 0 | 1 s | |
| 5 | `yarn i18n:check-usage` | **PASS** exit 0 | 113 s | |
| 6 | `yarn typecheck` | **KILLED** exit 137 | 17 s | 15/38 packages done, `@open-mercato/app#typecheck` SIGKILLed. Retried alone (`turbo run typecheck --filter=@open-mercato/app`): exit 137 again after 7 s. Not a type error — no verdict. **Effectively NOT RUN.** |
| 7 | `yarn test` | **FAIL** exit 1 (partial) | 5 s | turbo aborted after 3/44 tasks: jest worker `SIGSEGV` in `packages/webhooks/.../lib/__tests__/queue.test.ts`. That suite re-run alone (`--maxWorkers=1`) → `2 passed`, exit 0, 1 s, i.e. a load-related crash, not a test failure. Remaining 41 package test tasks **NOT RUN**. |
| 8 | `yarn build:app` | **KILLED** exit 137 | 17 s | `@open-mercato/app#build` SIGKILLed (heap 8192 MB configured in `apps/mercato/package.json`). **NOT RUN** (no result). |

Reading: everything up to and including i18n passes; the three heavy steps (app typecheck, full unit run, `next build`) could not
complete in this environment. Exit 137 is the memory guard / OOM described in the operator notes, not a flaky test. A first attempt earlier in the
session was also SIGKILLed (`build:packages --force` at concurrency 2, `generate`). The machine had rebooted at ≈23:02Z (uptime 14 min when probed),
and a Spotlight/`mds` load was running during the first attempts.
Full gate = not green and not measured end to end → do **not** cite it as 1.3/6.x evidence; run steps 6–8 on a quiet machine or in CI.

## Foreign containers (ports 3000 / 6379 / 7700)

Not running at the time of the check, and **not stopped by this task** (nothing was ever run against them; ports were only read with `lsof`).
`docker inspect` shows the other projects' containers (`infra-redis` on 6379, `web-admin`, `svc-*`, …) `Exited (255)` with
`FinishedAt=2026-09-18T23:08:01Z` — the Docker daemon restart right after the machine reboot — and no restart policy (`no`), while the
`omhack-*` containers came back on their own (`unless-stopped`). Port 3000/6379/7700 have no listeners. The acceptance line "foreign
containers still running" therefore cannot be confirmed; it is a host-reboot side effect, and restarting them is the owner's call (out of scope).

## Dev server

`http://localhost:3100/login` → no listener (connection refused) at the end of the task; the machine reboot killed it. Not started here:
the app-level steps above are being SIGKILLed and a dev server adds ≈2 GB. Start with
`OM_DEV_AUTO_OPEN=0 PORT=3100 yarn dev` (log `/tmp/omhack-dev.log`) when the machine is quiet.

## Blockers / open items for the H3 gate

1. **Full gate not proven on this machine** — app typecheck, full `yarn test`, `yarn build:app` end in exit 137 / worker SIGSEGV. Needs a quiet machine (or CI) before H3 can claim the gate. Owner: OSS-06 / EXEC.
2. **Dev server (`:3100`) down after reboot** — restart before UI/QA work needs a host (command above).
3. **Queue parallelism unproven** — `QUEUE_STRATEGY` unset → `local`; two-task parallel run (row 1.6) needs `QUEUE_STRATEGY=async` + `REDIS_URL` (→ `:6389`) and a worker budget check. Owner: EXEC.
4. **React Vite/TS demo repo** (workstream OSS-01 item) — not created by this task (scope was readiness/runner/build). Planned as sibling `../delivery-demo-react` with Vitest + JSON reporter. Needs an operator decision on where it lives / the preview target (external hosting = human).
5. **Preview target / Cezara CLI / Figma** — belong to EXEC / UI, not verified here.
6. **Foreign containers stopped by the host reboot** — see above; not ours to restart.

## Patch text for the QA/EXEC-owned `hackathon/delivery-demo/readiness.md`

That file does not exist yet (`hackathon/delivery-demo/` is absent). Not written by this task; apply as the OSS section:

````markdown
## OSS — environment readiness (OSS-01, 2026-09-19)

- Repo/branch: `open-mercato` `dev-mateusz` @ `38f46e056`; Node v24.15.0, Yarn 4.17.1.
- Runner: **local** (`yarn X`); no compose `app` container of this project is running. Infra only: `omhack-postgres` :5442, `omhack-redis` :6389, `omhack-meilisearch` :7710 (docker, healthy). App/dev server target: :3100 (currently **down** after a host reboot; `OM_DEV_AUTO_OPEN=0 PORT=3100 yarn dev`). Ports 3000/6379/7700 belong to other projects and are not used.
- Queue: `QUEUE_STRATEGY` unset → `local`; `REDIS_URL` set in local `.env` (→ :6389); no `QUEUE_REDIS_URL` exists; `DB_POOL_MAX=20`; `OM_WORKERS_DB_CONNECTION_BUDGET` unset (defaults to `DB_POOL_MAX`). Parallel-worker setup (`async`) NOT verified — EXEC row 1.6.
- Baseline `yarn build:packages`: exit 0, 1 s (turbo cache hit); forced rebuild exit 0, 70 s.
- Gate (`.ai/agentic.config.json`, sequential, `--concurrency=1`): generate PASS 12 s · build:packages PASS · i18n:check-sync PASS 1 s · i18n:check-usage PASS 113 s · typecheck KILLED 137 (NOT RUN) · test FAIL/partial (jest worker SIGSEGV in webhooks `queue.test.ts`, passes alone; remaining packages NOT RUN) · build:app KILLED 137 (NOT RUN). Full gate not yet green on this host.
- Evidence: OSS handover `context/changes/delivery-os-oss-domain/handover/OSS-01-readiness.md`. Human acceptance of Progress 1.1/1.3 still open.
- Open for H3: React demo repo + preview target (human), Cezara CLI (EXEC), Figma (UI), full gate on a quiet host/CI.
````

## Progress rows with evidence

- **1.1 (environment part):** evidence above (branch/SHA, versions, runner, ports, queue settings, baseline build, partial gate). Not ticked — human acceptance.
- **1.3:** partial evidence only (gate timing recorded; gate incomplete). Not ticked.

---

# OSS-01 (T002) — React Vite/TS demo repo (target app)

Task: OSS-01 / T002 · Progress row **1.3 (baseline build + sample AC of the target repo) — evidence only, not ticked** · recorded 2026-09-19.
This resolves open item 4 of the H3 list above (the demo repo now exists). The preview target (external hosting) is still a human item.

| Item | Value |
|------|-------|
| Absolute path | `/Users/mateuszstopinski/Documents/om-hack/proj2/delivery-demo-react` (sibling of the open-mercato root; own git repo, branch `main`) |
| Initial commit SHA | `687670c20c93d6a60c2ab494419ec38636cf0a8c` (`687670c`, "chore: bootstrap Vite React TS app with service catalogue and AC-001 test"), working tree clean |
| Node / npm | Node `v24.15.0`, npm `11.12.1` (registry reachable — no H3 network blocker) |
| Stack | Vite 8.3 + React 19 + TypeScript 6 (`create-vite` `react-ts` template), Vitest 5 + jsdom + `@testing-library/react` / `jest-dom` |
| Placeholder page | `src/App.tsx` → `ServiceCatalogue` listing 3 seeded services (`src/services.ts`), empty state `No services available yet.` |
| Scripts | `build` (`tsc -b && vite build`), `test` (`vitest run`, JSON reporter configured in `vite.config.ts`), `test:report` (explicit JSON reporter → `reports/vitest-report.json`), `lint` (oxlint, exit 0) |
| Preview target | not created — `previewTargetRef` is only the env parameter `PREVIEW_TARGET_REF` in `.env.example`; nothing deployed, no hosting account |

## Results

| Command (in the demo repo) | Exit | Summary |
|----------------------------|------|---------|
| `npm run build` | **0** | `tsc -b` clean; Vite: 18 modules, `dist/index.html` + `dist/assets/index-*.{js,css}` (JS 220 kB / 69 kB gzip), built in ≈0.3 s |
| `npm test` | **0** | 1 file, `1 passed (1)`; `AC-001: service list renders seeded services` passed; `reports/vitest-report.json` written (`success: true`, `numPassedTests: 1`) |
| `npm run test:report` | **0** | same run, same report path |
| failure path: AC-001 assertion deliberately broken (reverted) | **1** | Vitest exits non-zero and still writes the JSON report (`success: false`, `numFailedTests: 1`) — a failing AC is never reported as pass |
| fresh `git clone` + `npm ci` + build + test | **0 / 0** | the committed state is reproducible, nothing depends on untracked files |

`dist/`, `node_modules/`, `reports/` and `.env` are gitignored in the demo repo. Nothing from the demo app is inside the open-mercato git tree (it lives outside it).

## AC-id naming convention (for ResultManifest `checks[].testId` / `acIds[]` and `rawReportHash`)

Documented in the demo repo `README.md`; the ResultManifest and validation profile rely on it:

- Test title prefix `AC-<NNN>: <behaviour>` — `AC-` + three digits, unique per repo, never reused for a different behaviour (sample: `AC-001: service list renders seeded services`).
- One `it(...)` carries exactly one AC id; an AC covered by several tests repeats its id in every title.
- `checks[].testId` = the Vitest `fullName` in `reports/vitest-report.json` (`<describe title> <it title>`, e.g. `service catalogue AC-001: service list renders seeded services`); `checks[].acIds[]` = the `AC-NNN` prefix(es) parsed from the `it` title. A test without an `AC-NNN:` prefix proves no AC.
- `rawReportHash` = SHA-256 of the unmodified bytes of `reports/vitest-report.json` produced by `npm run test:report`; `testDefinitionHash` should be derived from the test file contents by the bridge (EXEC).
- Skipped/failed/todo tests appear in the JSON report with status `skipped`/`failed`/`todo` and must be mapped to `skipped`/`fail`/`not_run`, never to PASS.

## Limitations / notes

- The demo repo was committed by this task with an explicit git call in **its own** repo (the task requires the initial commit there); no git write was made in open-mercato.
- Vitest's JSON reporter has no per-test file hash or timing guarantees beyond what the report contains; bridge code computes the hashes.
- `previewTargetRef` / hosting stays a human item (H3 list item 5 above).

Progress rows with evidence: **1.3** (target-repo baseline build and sample AC test; the OM full-gate part remains incomplete — see above). Not ticked — human acceptance.
