---
id: asd-oss-b-t061-flow-f4-l20c-add-route-f14-post-get
title: "FLOW-F4 L20c: route F14 (POST/GET /projects/:id/publications), fake deploy adapter and the R20→F14→R21 chain test"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
owner: OSS lane B (autodev)
---

# Change

Expose `delivery_os.publications.record` (T060) over HTTP as route F14 (POST records, GET lists newest first), add the
deterministic `createFakeDeployAdapter()` for Michał/Marcin, and prove the publication seam end to end through the real
route handlers: R20 consent → F14 → R21 release, revision mismatch, and the flow gate on a pinned project.

Task: T061 (covers UA-43, UA-44 · FLOW-F4 / FLOW-07 seam / OSS-05 · Progress 5.1, 5.4).
