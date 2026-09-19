# OSS-06 Full Capped Gate — Plan Brief

> Full plan: `context/changes/asd-oss-t037-run-the-full-capped-gate-once-reprod/plan.md`

## What & Why
Feature freeze: run the CI-mirroring gate once on the final delivery_os code, memory-capped, reproduce OSS-only,
fix only delivery_os defects, and leave an honest gate record for Progress 6.1/6.2.

## Starting Point
HEAD 35e77c4dd, clean tree, dev server on :3100 with enterprise modules off in `.env`; jest capped at 2 workers by base config.

## Desired End State
`handover/OSS-06-gate.md` with every step's command, runner, duration, exit code, SHA; delivery_os failures fixed;
OSS-only registry verified; :3100 back up.

## Key Decisions Made
| Decision | Choice | Why |
|---|---|---|
| Test runner | turbo test concurrency=1, jest maxWorkers=2, docs site build excluded (not run) | RAM rule; docs "test" is a site build |
| build:app | stop dev server first, restart after | avoid next build + next dev RAM spike / shared distDir |
| Restore | default `.env` generate + core build | `.env` already = enterprise off; that is the dev config |
| Fix scope | delivery_os only; rest = patch requests | file ownership rules |

## Phases at a Glance
| Phase | Delivers | Key risk |
|---|---|---|
| 1. Gate + fixes | every step run once, delivery_os fixes | RAM kill / long runtime |
| 2. OSS-only + restore + record | registry proof, dev server up, gate record | dev server restart slow |
