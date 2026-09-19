# OSS-01: record environment readiness, runner and baseline build — Plan

Docs-only, low complexity. See [plan-brief.md](plan-brief.md) for decisions. Source: workstream OSS-01, master plan L0 / Progress 1.1 (environment part).

## Phase 1: Probe, measure, record

**Steps**
1. Confirm branch is `dev-mateusz` (not `main`), capture HEAD SHA, node and yarn versions.
2. Probe the runner in the order from `.ai/docs/agent-instructions.md` (`DOCKER_COMPOSE_FILE`, `starters/docker/compose.*dev*.local.yml`,
   legacy root `docker-compose.*dev*.local.yml`, `compose.fullapp.dev.yml`, `compose.fullapp.yml`, each `ps --status running -q app`).
3. Verify the isolated `omhack` stack (postgres :5442, redis :6389, meilisearch :7710), dev server on :3100, and that `.env`,
   `apps/mercato/.env` and any `docker-compose.*.local.yml` override are gitignored. Never touch 3000/6379/7700.
4. Verify `yarn install --immutable` is a no-op, run the ordered gate from `.ai/agentic.config.json` in the background with a script
   in `/tmp/omhack-gate/` (log + per-step timing outside git); step 1 is the baseline `yarn build:packages`.
5. Read queue settings from `apps/mercato/.env.example` (names only) and the default resolution in `packages/queue`.
6. Write `context/changes/delivery-os-oss-domain/change.md` and `handover/OSS-01-readiness.md` (branch/SHA, versions, runner, ports,
   queue settings, build result, gate timing, H3 blockers, patch text for `hackathon/delivery-demo/readiness.md`).
7. Verify: acceptance grep of both files, `git status` shows only the two new change folders, foreign containers still up.

**Failure paths covered:** gate step failing (recorded with exit code, later steps continue unless build/generate failed),
gate not finished in time (rows marked NOT RUN), turbo cache hit hiding real build cost (forced rebuild recorded separately),
secrets (names only, URLs redacted), foreign ports (never touched).

**Success criteria**
- Automated: both handover files exist and contain runner, ports, versions, build exit code + timing, gate step results.
- Automated: `git status --porcelain` lists no `.env`/compose/secret file and nothing under `hackathon/` or `context/changes/autonomous-software-delivery/`.
- Automated: `docker ps` still shows the foreign containers on 3000/6379/7700.

## References

- `context/changes/autonomous-software-delivery/workstreams/01-oss-domain.md` (OSS-01)
- `context/changes/autonomous-software-delivery/plan.md` (L0, Progress 1.1/1.3/1.6)
- `.ai/docs/agent-instructions.md` (runner probing), `.ai/agentic.config.json` (gate commands)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Probe, measure, record

#### Automated

- [x] 1.1 Branch, SHA, versions and runner probe recorded
- [x] 1.2 Full gate started in background with per-step timing
- [x] 1.3 OSS change folder with change.md and handover/OSS-01-readiness.md written
- [ ] 1.4 Acceptance checks pass (no tracked env/compose edits, foreign containers still running) — git status clean of env/compose/hackathon/master-plan edits; foreign containers NOT running (exited at host reboot 23:08Z, not by this task) — reported in handover
