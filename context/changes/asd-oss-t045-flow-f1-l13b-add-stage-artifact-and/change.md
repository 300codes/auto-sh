---
id: asd-oss-t045-flow-f1-l13b-add-stage-artifact-and
title: "FLOW-F1 L13b — stage artifact and stage decision commands"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# FLOW-F1 L13b — stage artifact and stage decision commands

Task T045 of the OSS stream (`context/changes/delivery-os-oss-domain/`). Adds the second half of the L13 command
layer of the Flow delta v1: `delivery_os.stages.create_artifact` (F7) and `delivery_os.stages.decide` (F8), built on
the pure rules of T042/T043 (`lib/stageArtifacts.ts`, `lib/stageDecisions.ts`) and the tables of T041.

- Spec: `.ai/specs/2026-09-18-delivery-os-hackathon.md` § Flow delta v1 (rows F7, F8; Currency D6; Template pinning D7)
- Rules: `lib/stageArtifacts.ts#planStageArtifact`, `lib/stageDecisions.ts#planStageDecision`, `lib/flowRules.ts#computeStageCurrency`
- Plan: [`plan.md`](plan.md), brief: [`plan-brief.md`](plan-brief.md)
