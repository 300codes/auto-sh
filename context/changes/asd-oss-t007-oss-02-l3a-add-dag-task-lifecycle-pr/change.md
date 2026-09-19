---
id: asd-oss-t007-oss-02-l3a-add-dag-task-lifecycle-pr
title: "OSS-02 (L3a): add DAG, task lifecycle, project status and basic traceability rules"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# OSS-02 (L3a): add DAG, task lifecycle, project status and basic traceability rules

Task T007 of the OSS stream (`context/changes/autonomous-software-delivery/workstreams/01-oss-domain.md`, OSS-02,
layer L3 core domain rules). Adds pure, I/O-free rule modules to `packages/core/src/modules/delivery_os/lib/`:
`dag.ts` (task graph validation and descendants), `taskLifecycle.ts` (transition table and gates),
`projectStatus.ts` (derived status and AC progress with explicit denominator) and `traceability.ts`
(requirement → AC → task → evidence rows, size-limited), each with unit tests.

- [Plan](plan.md)
- [Plan brief](plan-brief.md)

Covers UA-08, UA-09 (logic), part of UA-20 · capability C5 · evidence towards master-plan Progress 2.1
(not ticked by this task).
