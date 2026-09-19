---
change_id: asd-oss-t041-flow-f1-l11-add-flow-entities-f1-mig
title: FLOW-F1 L11 — flow entities, F1 migration, encryption map and F1 validators
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# T041 — FLOW-F1 data layer

Medium complexity. Additive data layer for the project-flow addendum (spec `.ai/specs/2026-09-18-delivery-os-hackathon.md`
§ Additive data models): nullable `flow_*` columns on `delivery_projects`, three new tables (`delivery_intakes`,
`delivery_flow_stage_artifacts`, `delivery_flow_stage_decisions`), `delivery_os/encryption.ts`, F1 command/route
validators and list-query schemas. No commands, routes or gate call sites (later F1 layers).
