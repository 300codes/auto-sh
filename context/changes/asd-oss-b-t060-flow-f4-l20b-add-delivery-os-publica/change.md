---
id: asd-oss-b-t060-flow-f4-l20b-add-delivery-os-publica
title: "FLOW-F4 L20b: delivery_os.publications.record — deploy-decision correlation, flow gate and v1 deployment evidence in one transaction"
status: implemented
created: 2026-09-19
updated: 2026-09-19
owner: OSS lane B (autodev)
---

# Change

Add the `delivery_os.publications.record` command (F14 contract, FLOW-F0 delta) on lane B: replay by payload hash, project optimistic lock,
named deploy-decision correlation, flow gate for pinned projects, v1 `deployment` evidence + `delivery_publications` row in ONE transaction.

Task: T060 (covers UA-43, UA-48 publication path · FLOW-F4 / OSS-05 · Progress 5.1, 5.4, 4.5).
