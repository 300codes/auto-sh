---
id: asd-oss-t009-oss-02-l4a-add-acl-setup-events-and
title: "OSS-02 (L4a): add ACL, setup, events and the execution extension point"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# OSS-02 (L4a): add ACL, setup, events and the execution extension point

Task T009 of the OSS stream (`context/changes/autonomous-software-delivery/workstreams/01-oss-domain.md`, OSS-02,
layer L4 registration). Adds the module registration files to `packages/core/src/modules/delivery_os/`: `acl.ts`
(8 features), `setup.ts` (default role features), `events.ts` (4 frozen event IDs with payload schemas),
`extension-points.ts` (the `delivery_os.project.execution` injection host), re-exports `features` from
`index.ts`, and adds a registration contract test.

- [Plan](plan.md)
- [Plan brief](plan-brief.md)

Covers UA-22, UA-25 (event contract) · OSS-02 · evidence towards master-plan Progress 2.2 (ACL split) and 2.3
(OSS/enterprise boundary); not ticked by this task.
