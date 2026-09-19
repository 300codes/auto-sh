---
id: asd-oss-t053-flow-f2-l16-add-staff-link-comment-t
title: "FLOW-F2 L16: staff-link, comment thread/reply entities, F2 migration, encryption map and pure comment-import rules"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
---

Data layer and pure rules for the Figma → staff Kanban import (F10–F13 of the F0 contract): three additive
entities + migration `…_delivery_os_flow_f2.ts` + snapshot, encryption map entries for comment PII, F10–F13
command/query validators, and `lib/commentImport.ts` (diff/plan, revision detection, version binding, staff
rendering, cursor and batch-key rules) with fixture-driven tests. Commands and routes follow in L17/L18.
