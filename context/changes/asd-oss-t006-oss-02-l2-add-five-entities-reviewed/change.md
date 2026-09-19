---
id: asd-oss-t006-oss-02-l2-add-five-entities-reviewed
title: "OSS-02 (L2): add five entities, reviewed migration, validators and module registration stub"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# OSS-02 (L2): add five entities, reviewed migration, validators and module registration stub

Task T006 of the OSS stream (`context/changes/autonomous-software-delivery/workstreams/01-oss-domain.md`, OSS-02,
layer L2 Data). Adds `delivery_os/index.ts` (metadata only), `data/entities.ts` (five MikroORM entities, FK ids only),
the reviewed `delivery_*` migration plus module snapshot, `data/validators.ts` (API input schemas) with tests, and the
one-line registration in `apps/mercato/src/modules.ts` followed by `yarn generate`. No commands, routes, ACL, events or DI yet.

- [Research](research.md)
- [Plan](plan.md)
- [Plan brief](plan-brief.md)

Covers the data layer for UA-01…UA-20 · capabilities C3, C4, C10 (part) · evidence towards master-plan Progress 2.1
(not ticked by this task).
