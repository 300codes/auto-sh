---
id: asd-oss-t033-add-the-deploy-publish-consent-decis
title: "OSS-05 (L9c): deploy (publish consent) decision and route R20"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# OSS-05 (L9c): deploy (publish consent) decision and route R20

Task T033 of the OSS stream (`context/changes/autonomous-software-delivery/workstreams/01-oss-domain.md`, OSS-05).
Extends `delivery_os.decisions.record` with kind `deploy` (gated by the same report query R22 uses) and adds
`POST /api/delivery_os/projects/:id/deploy-decisions` (R20, `delivery_os.deploy.approve`).

- [Plan](plan.md)
- [Plan brief](plan-brief.md)

Covers UA-16, UA-14 · OSS-05 · Progress 5.1 (deploy gate), 5.4 (OSS side).
