---
change_id: asd-oss-t043-flow-f1-l12b-add-pure-stage-decision
title: FLOW-F1 L12b — pure stage-decision and flow-status rules
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# T043 — FLOW-F1 pure stage-decision and flow-status rules

High complexity. Two pure, ORM-free rule modules (`lib/stageDecisions.ts`, `lib/flowStatus.ts`) that the F8 command
(`stages.decide`), the F6 read route, the DI `deliveryOsFlowQueries` seam and the F15 report extension will call, with
unit tests driven by the F0 fixtures. Covers UA-33, UA-36, UA-44 (logic), FLOW-02/04/09 evidence, Progress 3.3, 5.1.
