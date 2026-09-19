---
id: asd-oss-t032-oss-05-l9b-add-report-route-r22-and
title: "OSS-05 (L9b): add report route R22 and the report query"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# OSS-05 (L9b): add report route R22 and the report query

Task T032 of the OSS stream (`context/changes/autonomous-software-delivery/workstreams/01-oss-domain.md`, OSS-05).
Adds the read-only report route `GET /api/delivery_os/projects/:id/report` (R22) and a scoped loader
`deliveryOsReportQueries` (DI, additive) that feeds `buildDeliveryReport` from stored rows.

- [Plan](plan.md)
- [Plan brief](plan-brief.md)

Covers UA-20 · OSS-05 · Progress 5.1 (OSS side).
