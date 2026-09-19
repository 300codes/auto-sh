---
id: asd-oss-t012-oss-02-l4d-add-manual-baseline-creat
title: "OSS-02 (L4d): add manual baseline creation and atomic requirements/design decisions"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# OSS-02 (L4d): add manual baseline creation and atomic requirements/design decisions

Task T012 of the OSS stream (`context/changes/autonomous-software-delivery/workstreams/01-oss-domain.md`, OSS-02,
layer L4 commands). Adds `commands/baselines.ts` (`delivery_os.baselines.create`, source `manual`) and
`commands/decisions.ts` (`delivery_os.decisions.record`, kinds `requirements` and `design`) to
`packages/core/src/modules/delivery_os/`, registered in `commands/index.ts`, with unit tests.

- [Research](research.md)
- [Plan](plan.md)
- [Plan brief](plan-brief.md)

Covers UA-05, UA-15 · OSS-02 · evidence towards master-plan Progress 2.1, 2.2; groundwork for 3.1.
