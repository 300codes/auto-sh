# FLOW-F1 L13a — intake and flow-pin commands (T044)

**Plan:** `context/changes/asd-oss-t044-flow-f1-l13a-add-intake-and-flow-pin/` · **Spec:** `.ai/specs/2026-09-18-delivery-os-hackathon.md`
§ Flow delta v1 rows F2–F5, Events, DI (changelog entry 2026-09-19 T044). **Commit:** recorded by the orchestrator.

## What landed

| Piece | Where |
|---|---|
| `delivery_os.intake.update` (F2), `delivery_os.intake.import_proposal` (F3) | `commands/intake.ts` |
| `delivery_os.flow.pin` (F4), `delivery_os.flow.link_instance` (F5, trusted, not routable) | `commands/flow.ts` |
| `deliveryFlowTemplateProvider` contract + OSS built-in default | `commands/flowTemplateProvider.ts`, registered in `di.ts` |
| `findScopedIntake`, `DELIVERY_INTAKE_RESOURCE_KIND`, `deliveryFlowHttpError`, `assertDeliveryFlowCheck` | `commands/shared.ts` |
| ACL `delivery_os.flow.manage`, `delivery_os.stages.approve`, `delivery_os.comments.import` (employee gets `comments.import`) | `acl.ts`, `setup.ts` |
| Events `delivery_os.flow.pinned`, `delivery_os.stage.artifact_created` (broadcast), `delivery_os.stage.decided` (broadcast), `delivery_os.comment_thread.imported` — declared, ids only; only `flow.pinned` is emitted yet | `events.ts` |
| Tests | `commands/__tests__/{intake,flow}.test.ts`, updated `scopeChange`, `attemptQueries`, `__tests__/module-registration` |

## Contract facts for Adam (UI) and Marcin (workflow)

- **F2 lock** is the intake's own `updatedAt` (always read from the row after commit — the entity `onUpdate` hook is authoritative); the first write sends the project `createdAt` that F1 will return. Autosave never bumps the project version. Body `proposals` are ignored. `step` may go back freely or forward by one; `submitted` needs every blocking question answered and a `platform.chosen` equal to the frozen profile (`422 target_profile_frozen` otherwise).
- **F3** is idempotent by `manifestId` + content hash (replay needs no lock header; same id + other content → `409 idempotency_conflict`). The agent calls the command in-process with an issued `trustedExecution` (no lock header needed); over HTTP the option is refused with 403. New questions arrive unanswered; a blocking one reopens a `submitted` intake to `review`. The proposal document is **not stored** — only its ref + hash + the platform recommendation. The Scope content must be submitted as the F7 `scope` artifact (`source: intake`) by the caller (UI or agent) from the same proposal.
- **F4** `flow.pin`: `{ projectId, templateId, templateVersion }` with the project lock header → `FlowPinResponse & { duplicate }`; route maps `duplicate` to 200/201. Re-pin to the same id+version returns the stored snapshot body without consulting the provider; another template → `409 flow_already_pinned`.
- **Provider seam (Marcin):** register `deliveryFlowTemplateProvider` with `getTemplate(templateId, version)` returning a `FlowTemplateV1`, `{ template, hash }` (hash checked against `hashFlowTemplate`, `422 flow_template_hash_mismatch`), or `null` (`422 unknown_flow_template`). The template's own `templateId`/`version` must equal the request.
- **F5** `flow.link_instance`: `{ projectId, workflowInstanceId, definitionId, workflowId, version, trustedExecution }` via `issueTrustedExecution(actorUserId)`; unpinned → `422 flow_not_pinned`; same instance → `changed: false`; other → `409 flow_already_pinned` (`instance_already_linked`).

## Evidence

- `yarn workspace @open-mercato/core jest src/modules/delivery_os src/__tests__/module-decoupling.test.ts --maxWorkers=2` → 66 suites, 1447 tests green (after the DI-key expectation update and the impl-review fixes recorded in `reviews/impl-review.md`).
- `yarn generate` clean (known Node 24 OpenAPI bundle notice only); `yarn turbo run typecheck --filter=@open-mercato/core --concurrency=2` green; eslint on touched files clean.

## Limitations / next

- No routes yet (L14): F1/F6 GETs, F2–F4 HTTP surface, OpenAPI and mutation guards. `TC-DELIVERY-FLOW-01` ships with them.
- Gate call sites (`tasks.ts`/`attempts.ts`/`decisions.ts`) and `stages.create_artifact`/`stages.decide` are L13b.
- Proposal document storage would need a column (not in T041); decide in L13b if F7 needs it server-side.
- Manual acceptance rows of the master plan remain human-only.
