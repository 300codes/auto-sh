---
id: asd-oss-t026-oss-04-l8c-add-attempt-cancel-comman
title: "OSS-04 (L8c): add attempt cancel command and route R17"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# OSS-04 (L8c): add attempt cancel command and route R17

Task T026 of the OSS stream (`context/changes/autonomous-software-delivery/workstreams/01-oss-domain.md`, OSS-04,
layer L8 of the breakdown). Adds the user-facing cancel of an execution attempt: command
`delivery_os.attempts.cancel` over the pure `requestCancellation` reducer and the route
`POST /api/delivery_os/tasks/:id/attempts/:attemptId/cancel` (R17). A cancel only records the request
(`cancel_requested` / `stop_unconfirmed`); it never claims the external process stopped. Reserve, archive and late
results stay blocked until the attempt is reconciled (R18, next task).

- [Plan](plan.md)
- [Plan brief](plan-brief.md)

Covers UA-18 · OSS-04 · evidence towards master-plan Progress 4.2.
