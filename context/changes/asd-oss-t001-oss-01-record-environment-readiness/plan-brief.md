# Plan brief — OSS-01 environment readiness

**Goal:** give the team a factual, secret-free record of the OM environment (branch/SHA, versions, runner, ports, queue
settings, baseline build, full-gate timing, H3 blockers) plus a ready-to-apply patch for the QA/EXEC-owned
`hackathon/delivery-demo/readiness.md`.

**Approach:** probe (no changes to shared infra) → run the ordered gate from `.ai/agentic.config.json` in the background via an
untracked script in `/tmp/omhack-gate/` → write two docs. One phase, docs only.

**Decisions (self-answered):**
- Runner = local (no compose `app` container of this project running; only `omhack-{postgres,redis,meilisearch}` infra).
- Reuse the existing isolated `omhack` stack and `apps/mercato/.env`; nothing to create, nothing to commit.
- `yarn build:packages` step 1 of the gate is the recorded baseline build; a forced rebuild (`--force`) is recorded separately as
  the honest cold-build figure because the first run is a 100 % turbo cache hit.
- Gate continues after a non-build failure so every step gets a real result; steps that never ran are marked NOT RUN.
- QUEUE_STRATEGY is recorded as observed (unset → `local`), reported as an H3 parallelism blocker (row 1.6) for EXEC; `.env` is not changed.
- No React demo repo is created here: the workstream ties it to OSS-01 but this task's acceptance is scoped to readiness/runner/build;
  it is listed as an open H3 item.

**Out of scope:** Cezara CLI attempt, Figma, preview target, applying migrations, editing `hackathon/**` or the master plan.
