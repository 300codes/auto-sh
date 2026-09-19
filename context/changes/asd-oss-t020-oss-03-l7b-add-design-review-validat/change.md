---
id: asd-oss-t020-oss-03-l7b-add-design-review-validat
title: "OSS-03 (L7b): add design-review validation and attachment scope/hash verification for baselines"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# OSS-03 (L7b): add design-review validation and attachment scope/hash verification for baselines

Task T020 of the OSS stream (`context/changes/autonomous-software-delivery/workstreams/01-oss-domain.md`, OSS-03,
layer L7 / component C11 of the breakdown). Adds the pure `lib/designReview.ts` (DesignManifest v1 / draft screen,
comment and token rules) and makes `delivery_os.baselines.create` verify every referenced attachment against the
attachments module: tenant + organization scope, type, size and the sha256 of the stored bytes. The verified
id + hash + size + type snapshot lands in the baseline content. No ORM relation to the attachments module.

- [Research](research.md)
- [Plan](plan.md)
- [Plan brief](plan-brief.md)

Covers UA-05, UA-03 · BN-03, BN-05, BN-07 · OSS-03 · evidence towards master-plan Progress 3.1, 3.2.
