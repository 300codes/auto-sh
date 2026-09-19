---
id: delivery-os-oss-domain
title: "Delivery OS — OSS stream: domain, contracts and integration"
status: handed_over
created: 2026-09-19
updated: 2026-09-19
---

# Delivery OS — OSS stream

Change folder owned by the OSS stream for per-task plans and hand-over notes. The shared master plan under
`context/changes/autonomous-software-delivery/` stays read-only for this stream.

- **Workstream:** [`01-oss-domain.md`](../autonomous-software-delivery/workstreams/01-oss-domain.md) (OSS-01 … OSS-06)
- **Master plan:** [`plan.md`](../autonomous-software-delivery/plan.md) — Progress rows are accepted by a human only.
- **Owner:** OSS stream (`dev-mateusz`).

## Scope

Module `packages/core/src/modules/delivery_os/{data,lib,commands,api,migrations}/` plus `index.ts`, `acl.ts`, `setup.ts`, `events.ts`,
`di.ts`, `extension-points.ts`, the one-line registration in `apps/mercato/src/modules.ts`, and domain unit tests.
Strictly additive; not mirrored into the create-app template. Not in scope: `packages/enterprise/**`, `packages/delivery-cezar/**`,
`delivery_os/{backend,components,i18n}/**`, `__integration__/TC-DELIVERY-*`, `hackathon/delivery-demo/**`.

## Hand-over notes

| Task | Note |
|------|------|
| OSS-01 (T001) | [`handover/OSS-01-readiness.md`](handover/OSS-01-readiness.md) — environment, runner, ports, queue settings, baseline build, gate timing, H3 blockers, patch text for `hackathon/delivery-demo/readiness.md` |
| OSS-01 (T003) | [`handover/OSS-01-api-and-tests.md`](handover/OSS-01-api-and-tests.md) — frozen v1 API paths R1–R22, internal commands, planned test files per layer; specs `.ai/specs/2026-09-18-delivery-os-hackathon.md` and `.ai/specs/enterprise/2026-09-18-delivery-agents-hackathon.md` |
| OSS-06 (T039) | [`handover/OSS-06-final.md`](handover/OSS-06-final.md) — final commit, versions, commit table, gate results, evidence per Progress row, manual rows left open, limitations, patch requests, A1 note, judge talking points; also `OSS-06-gate.md`, `OSS-06-migration-and-history.md`, `FLOW-F0-contracts.md` |
