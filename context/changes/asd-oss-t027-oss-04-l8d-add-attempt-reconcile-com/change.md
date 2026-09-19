---
id: asd-oss-t027-oss-04-l8d-add-attempt-reconcile-com
title: "OSS-04 (L8d): add attempt reconcile command and route R18"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# OSS-04 (L8d): add attempt reconcile command and route R18

Task T027 of the OSS stream (`context/changes/autonomous-software-delivery/workstreams/01-oss-domain.md`, OSS-04,
layer L8 of the breakdown). Adds the human decision that ends an uncertain execution attempt: command
`delivery_os.attempts.reconcile` over the pure `reconcileAttempt` reducer and the route
`POST /api/delivery_os/tasks/:id/attempts/:attemptId/reconcile` (R18). `not_started` / `stopped` close the attempt
and release the task, `completed` runs exactly the result acceptance of R16, `unknown` blocks the task with
`reconciliation_required`. Nothing is restarted or dispatched by the system.

- [Research](research.md)
- [Plan](plan.md)
- [Plan brief](plan-brief.md)

Covers UA-19 · OSS-04 · evidence towards master-plan Progress 4.2.
