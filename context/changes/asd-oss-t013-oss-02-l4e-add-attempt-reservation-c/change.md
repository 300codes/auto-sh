---
id: asd-oss-t013-oss-02-l4e-add-attempt-reservation-c
title: "OSS-02 (L4e): add attempt reservation command and pure TaskPackage builder"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# OSS-02 (L4e): add attempt reservation command and pure TaskPackage builder

Task T013 of the OSS stream (`context/changes/autonomous-software-delivery/workstreams/01-oss-domain.md`, OSS-02,
layer L4 commands). Adds `lib/taskPackage.ts` (pure `buildTaskPackageV1`) and `commands/attempts.ts`
(`delivery_os.attempts.reserve`) to `packages/core/src/modules/delivery_os/`, registered in `commands/index.ts`,
with unit tests.

- [Research](research.md)
- [Plan](plan.md)
- [Plan brief](plan-brief.md)

Covers UA-10, UA-11 (builder), UA-23 (reserve part) · OSS-02 · evidence towards master-plan Progress 2.1, 4.1 (OSS side).
