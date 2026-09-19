---
id: asd-oss-t022-oss-03-l7d-add-plan-proposal-import
title: "OSS-03 (L7d): add plan-proposal import creating the merged baseline and tasks atomically"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# OSS-03 (L7d): add plan-proposal import creating the merged baseline and tasks atomically

Task T022 of the OSS stream (`context/changes/autonomous-software-delivery/workstreams/01-oss-domain.md`, OSS-03,
layer L7 of the breakdown). Adds the command `delivery_os.tasks.import_plan` and wires it on R10
(`POST /api/delivery_os/projects/:id/tasks`, `source: 'plan_proposal'`): a validated `PlanProposal v1` prepared for
the active, approved baseline becomes one merged baseline version (parent link, plan section, frozen AC→test map)
plus draft tasks keyed by `proposalTaskKey`, in one transaction, idempotently by `manifestId` + manifest hash.

- [Research](research.md)
- [Plan](plan.md)
- [Plan brief](plan-brief.md)

Covers UA-07, UA-08, UA-09 · BN-05..08 · OSS-03 · evidence towards master-plan Progress 3.3, 3.6.
