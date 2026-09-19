---
id: asd-oss-t046-flow-f1-l13c-enforce-the-flow-gate-o
title: "FLOW-F1 L13c — enforce the flow gate on v1 ready, reserve and deploy commands"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# FLOW-F1 L13c — enforce the flow gate on v1 ready, reserve and deploy commands

Task T046 of the OSS stream (`context/changes/delivery-os-oss-domain/`). Closes C21 of the breakdown: pinned
projects can no longer be dispatched or given publish consent through the frozen v1 commands/routes while any
approval stage (scope, ux, key_visual, design_system_ui) is missing, pending, rejected or stale. Legacy (unpinned)
projects keep byte-identical behaviour (FLOW-08).

- Spec: `.ai/specs/2026-09-18-delivery-os-hackathon.md` § Flow delta v1 → "Server-side gate (D5)"
- Rules: `lib/flowRules.ts#checkFlowGate`, `#computeStageCurrency`
- Breakdown: UA-48, UA-49; BN-23, BN-31
- Plan: [`plan.md`](plan.md), brief: [`plan-brief.md`](plan-brief.md), research: [`research.md`](research.md)
