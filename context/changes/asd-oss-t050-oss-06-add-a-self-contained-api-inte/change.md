---
id: asd-oss-t050-oss-06-add-a-self-contained-api-inte
title: "OSS-06: add a self-contained API integration spec for the v1 manual flow against the real database"
status: impl_reviewed
created: 2026-09-19
updated: 2026-09-19
owner: OSS stream (Mateusz)
---

## Why

OSS-06-final.md §6 admits that every delivery_os route test runs on an in-memory store. SQL-level behaviour — scoping
filters, unique and partial indexes, row locks, JSON columns, encryption helpers — was only covered by the migration
review. A Playwright API spec against the real app + Postgres closes that gap and is the FLOW-08 v1 regression net.

## Scope

- `packages/core/src/modules/delivery_os/__integration__/TC-DELIVERY-OSS-001.spec.ts` (OSS-owned, new).
- Fix any real delivery_os defect the spec uncovers (frozen v1 rules), with a jest regression next to the code.
- Evidence appended to `handover/OSS-06-polish.md` and `handover/OSS-06-final.md` §4/§6.

## Out of scope

QA's `TC-DELIVERY-UI-*` / `TC-DELIVERY-EXEC-*`, FLOW F1+ routes, shared helpers under `packages/core/src/helpers/integration/`.
