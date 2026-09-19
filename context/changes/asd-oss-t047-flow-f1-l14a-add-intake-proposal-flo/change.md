---
id: asd-oss-t047-flow-f1-l14a-add-intake-proposal-flo
title: "FLOW-F1 L14a: intake, proposal, flow status and flow pin routes"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

# FLOW-F1 L14a — HTTP routes F1/F2/F3/F4/F6

Exposes the L13a commands (`delivery_os.intake.update`, `delivery_os.intake.import_proposal`, `delivery_os.flow.pin`)
and the F6 FlowStatus v1 read model over `/api/delivery_os/projects/:id/{intake,intake/proposals,flow,flow/pin}`.
Covers UA-30…33, UA-46 · FLOW-01 evidence · master-plan Progress 2.1/2.2 (flow). Spec: `.ai/specs/2026-09-18-delivery-os-hackathon.md` § Operations F1–F6.
