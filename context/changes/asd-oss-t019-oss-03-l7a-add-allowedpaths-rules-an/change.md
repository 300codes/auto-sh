---
id: asd-oss-t019-oss-03-l7a-add-allowedpaths-rules-an
title: "OSS-03 (L7a): add allowedPaths rules and pure proposal import validation"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# OSS-03 (L7a): add allowedPaths rules and pure proposal import validation

Task T019 of the OSS stream (`context/changes/autonomous-software-delivery/workstreams/01-oss-domain.md`, OSS-03,
layer L7 of the breakdown). Adds the pure domain rules behind the agent-proposal imports: `lib/allowedPaths.ts`
(path grammar + profile roots + changed-path matching) and `lib/proposals.ts` (RequirementsProposal v1 and
PlanProposal v1 validation, merged draft / merged baseline content, manifest hash). Commands and routes that call
them are the next task (L7b).

- [Plan](plan.md)
- [Plan brief](plan-brief.md)

Covers UA-06, UA-07 (logic) · BN-07, BN-08 · OSS-03 · evidence towards master-plan Progress 3.3, 3.6.
