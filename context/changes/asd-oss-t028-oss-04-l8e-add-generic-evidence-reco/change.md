---
id: asd-oss-t028-oss-04-l8e-add-generic-evidence-reco
title: "OSS-04 (L8e): add generic evidence recording command and route R19"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# OSS-04 (L8e): add generic evidence recording command and route R19

Task T028 of the OSS stream (`context/changes/autonomous-software-delivery/workstreams/01-oss-domain.md`, OSS-04 /
OSS-05 input side, layer L8 of the breakdown). Adds the append-only command `delivery_os.evidence.record` and the
route `POST /api/delivery_os/projects/:id/evidence` (R19) for the kinds `test`, `screenshot`, `scan`, `deployment`
and `reference_material`. The `review` kind is wired in the schema but dispatched in the next task (L8f). The
endpoint never publishes and never changes a task status.

- [Research](research.md)
- [Plan](plan.md)
- [Plan brief](plan-brief.md)

Covers UA-13, UA-27 · OSS-04/OSS-05 · evidence towards master-plan Progress 4.1, 5.1 (input side).
