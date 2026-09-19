---
id: asd-oss-t008-oss-02-l3b-add-execution-attempt-red
title: "OSS-02 (L3b): add execution-attempt reducers and baseline build/readiness rules"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# OSS-02 (L3b): add execution-attempt reducers and baseline build/readiness rules

Task T008 of the OSS stream (`context/changes/autonomous-software-delivery/workstreams/01-oss-domain.md`, OSS-02,
layer L3 core domain rules). Adds two pure, I/O-free rule modules to
`packages/core/src/modules/delivery_os/lib/`: `attempts.ts` (reserve / claim / cancel / reconcile reducers over the
validated `executionAttempts` register, archive block) and `baseline.ts` (build + hash of `BaselineContent v1` from the
draft, version numbering, stable ids, decision resolution and the task ready gate), each with unit tests.

- [Research](research.md)
- [Plan](plan.md)
- [Plan brief](plan-brief.md)

Covers UA-09, UA-10, UA-11, UA-15 (logic), groundwork for UA-18, UA-19, UA-23 · capability C5 · evidence towards
master-plan Progress 2.1 (not ticked by this task).
