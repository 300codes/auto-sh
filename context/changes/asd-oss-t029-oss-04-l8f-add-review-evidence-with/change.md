---
id: asd-oss-t029-oss-04-l8f-add-review-evidence-with
title: "OSS-04 (L8f): add review evidence with changes_requested / verified transitions and correction limit"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# OSS-04 (L8f): add review evidence with changes_requested / verified transitions and correction limit

Task T029 of the OSS stream (`context/changes/autonomous-software-delivery/workstreams/01-oss-domain.md`, OSS-04,
layer L8 of the breakdown). Extends `delivery_os.evidence.record` (route R19) with the kind `review`: a review moves
the task `awaiting_review → changes_requested | blocked/correction_limit_reached | verified` under row locks, a
review with `manualCheckId` records the human verdict of a manual AC, and the new pure helper `lib/acProof.ts`
decides whether every AC is proven on the result revision (reused by the OSS-05 report).

- [Research](research.md)
- [Plan](plan.md)
- [Plan brief](plan-brief.md)

Covers UA-13, UA-09 · OSS-04 · evidence towards master-plan Progress 4.3, 4.4 (OSS side), 5.1.
