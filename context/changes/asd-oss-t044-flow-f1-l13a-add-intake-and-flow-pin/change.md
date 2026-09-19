---
id: asd-oss-t044-flow-f1-l13a-add-intake-and-flow-pin
title: "FLOW-F1 L13a — intake and flow-pin commands, ACL features, events, template provider DI"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# FLOW-F1 L13a — intake and flow-pin commands

Task T044 of the OSS stream (`context/changes/delivery-os-oss-domain/`). Adds the first half of the L13 command layer of
the Flow delta v1: `delivery_os.intake.update`, `delivery_os.intake.import_proposal`, `delivery_os.flow.pin`,
`delivery_os.flow.link_instance` (trusted), the additive ACL features, the four additive events (declared, ids only) and
the `deliveryFlowTemplateProvider` DI seam with the OSS built-in default.

- Spec: `.ai/specs/2026-09-18-delivery-os-hackathon.md` § Flow delta v1 (rows F2–F5, Events, DI)
- Rules: `lib/intakeRules.ts` (T042), entities/validators (T041)
- Plan: [`plan.md`](plan.md), brief: [`plan-brief.md`](plan-brief.md)
