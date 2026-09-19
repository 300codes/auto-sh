---
id: asd-oss-t040-flow-f0-publish-the-versioned-contra
title: "FLOW-F0: publish the versioned contract delta (models, API, zod schemas, fixtures) for the project-flow addendum"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
owner: OSS stream (Mateusz)
workstream: FLOW-F0 (blocks Marcin, Adam, Michał)
---

# Change: FLOW-F0 contract delta

Design-only deliverable on top of the frozen delivery_os v1 contracts: a new spec section
(`.ai/specs/2026-09-18-delivery-os-hackathon.md` → "Flow delta v1 (FLOW-F0)"), additive zod schemas in
`lib/contracts.ts` under a new `DELIVERY_FLOW_CONTRACT_VERSION`, positive and negative fixtures under
`lib/fixtures/flow/`, schema tests, and the hand-over `context/changes/delivery-os-oss-domain/handover/FLOW-F0-contracts.md`.

No route, command, migration, entity, ACL feature or event is implemented in this task.
