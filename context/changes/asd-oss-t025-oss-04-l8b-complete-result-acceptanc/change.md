---
id: asd-oss-t025-oss-04-l8b-complete-result-acceptanc
title: "OSS-04 (L8b): complete result acceptance checks (changed paths, checks shape, attachments, size)"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# OSS-04 (L8b): complete result acceptance checks (changed paths, checks shape, attachments, size)

Task T025 of the OSS stream (`context/changes/autonomous-software-delivery/workstreams/01-oss-domain.md`, OSS-04,
layer L8 of the breakdown). Replaces the three pass-through seams in `lib/resultAcceptance.ts` with real rules:
changed paths inside the task's `allowedPaths`, `checks[]` bound to the frozen AC/test maps and profile, stored
artifact attachments verified by scope and hash, and size/count limits. One function serves `manual` and `adapter`.

- [Research](research.md)
- [Plan](plan.md)
- [Plan brief](plan-brief.md)

Covers UA-12, UA-24 · OSS-04 · evidence towards master-plan Progress 4.1, 4.7 (OSS side).
