---
id: asd-oss-t024-oss-04-l8a-add-claim-link-workflow-a
title: "OSS-04 (L8a): add claim, link_workflow and mark_delivery commands and close the attempt on accept"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# OSS-04 (L8a): add claim, link_workflow and mark_delivery commands and close the attempt on accept

Task T024 of the OSS stream (`context/changes/autonomous-software-delivery/workstreams/01-oss-domain.md`, OSS-04,
layer L8 of the breakdown). First OSS-04 step: the internal commands the EXEC bridge needs for the live vertical
trial (`delivery_os.attempts.claim`, `.link_workflow`, `.mark_delivery`), the pure reducers behind them, and
`delivery_os.results.accept` closing the attempt in the same transaction as the evidence write.

- [Research](research.md)
- [Plan](plan.md)
- [Plan brief](plan-brief.md)

Covers UA-23, UA-24, UA-25 · BN-09, BN-10, BN-14 · OSS-04 · evidence towards master-plan Progress 4.1, 4.7
(OSS side; the workflow side is accepted with EXEC/QA).
