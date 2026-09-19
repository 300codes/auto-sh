---
id: asd-oss-t048-flow-f1-l14b-add-stage-artifact-and
title: "FLOW-F1 L14b: stage artifact and stage decision routes with history listing"
status: implemented
created: 2026-09-19
---

HTTP layer for the frozen F0 operations F7 (`POST …/stages/:stageId/artifacts`), F8 (`POST …/stages/:stageId/decisions`)
and F9 (`GET` history of both). Commands exist (T045); this adds routes, list contracts, serializers, route tests,
the spec status lines and the FLOW-F1 hand-over.
