# FLOW-F1 L14a — intake, proposal, flow status and pin routes (hand-over)

For Adam (wizard / project detail UI) and Marcin (scoping agent, project workflow). Contract: spec rows F1–F4, F6 (unchanged).

| Route | Feature | Answer |
|---|---|---|
| `GET /api/delivery_os/projects/:id/intake` | projects.view | `200 IntakeResponse`; default `step: brief`, `updatedAt` = project `createdAt` until the first save |
| `PUT /api/delivery_os/projects/:id/intake` | projects.manage | body = whole draft; header `x-om-ext-optimistic-lock-expected-updated-at: <intake updatedAt>` (428 without, 409 stale); `proposals` ignored |
| `POST /api/delivery_os/projects/:id/intake/proposals` | results.import | ScopingProposal v1 → 201; same manifest → 200 `duplicate: true` without header; 422 `unsupported_schema_version` / `foreign_reference` / `manifest_required` |
| `GET /api/delivery_os/projects/:id/flow` | projects.view | `200 FlowStatus v1`; legacy → `template: null`, open gates, blocker `template_not_pinned`, `nextAction pin_template` once an intake exists |
| `POST /api/delivery_os/projects/:id/flow/pin` | flow.manage (not in the employee set) | `{ templateId: 'delivery-default', templateVersion: 1 }` + project header → 201 `FlowPinResponse`; replay 200; other template 409 `flow_already_pinned` |

- DI: `deliveryOsFlowQueries.flowStatus(projectId, { tenantId, organizationId })` → same document as the route (for workflow steps). File `commands/flowQueries.ts`.
- The intake version is independent of the project version: editing the project never invalidates an open wizard draft and vice versa.
- An unreadable pinned snapshot fails closed in F6 (both gates closed, `nextAction none`).
- Tests: `yarn workspace @open-mercato/core jest src/modules/delivery_os/api/__tests__/{intake,flowStatus,flowPin}.route.test.ts --maxWorkers=2` → 35 tests green; live curl smoke on :3100 passed (see T047 notes).
- Known: the 428 message for the intake header reads "The project version header is required" (shared `requireLockHeader` text); the code `optimistic_lock_required` is what clients should branch on.
