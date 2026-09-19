---
id: asd-oss-t036-add-the-final-commit-regression-suit
title: "OSS-06: final-commit regression suite (cross-tenant, stale approval, duplicate callback, restart, manual_handoff)"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# OSS-06: final-commit regression suite

Task T036 of the OSS stream (`context/changes/autonomous-software-delivery/workstreams/01-oss-domain.md`, OSS-06).
One route-level jest file that re-runs, on the final code, the five scenarios of master-plan row 6.2 through the real
route handlers (routeTestKit in-memory store).

- [Plan](plan.md)
- [Plan brief](plan-brief.md)

Covers UA-02, UA-12, UA-15, UA-19, UA-26 · OSS-06 · Progress 6.2 (OSS unit/route evidence), 6.3.
