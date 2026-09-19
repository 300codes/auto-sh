---
id: asd-oss-t021-oss-03-l7c-add-requirements-proposal
title: "OSS-03 (L7c): add requirements-proposal import on the baselines route"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# OSS-03 (L7c): add requirements-proposal import on the baselines route

Task T021 of the OSS stream (`context/changes/autonomous-software-delivery/workstreams/01-oss-domain.md`, OSS-03,
layer L7 of the breakdown). Adds the command `delivery_os.baselines.import_requirements` and wires it on R7
(`POST /api/delivery_os/projects/:id/baselines`, `source: 'requirements_proposal'`): a validated
`RequirementsProposal v1` is merged into the project draft and frozen as the next append-only baseline version
through the same builder as the manual path, idempotently by `manifestId` + manifest hash.

- [Research](research.md)
- [Plan](plan.md)
- [Plan brief](plan-brief.md)

Covers UA-06 · BN-05, BN-07 · OSS-03 · evidence towards master-plan Progress 3.1, 3.3 (and the requirements half of 3.6).
