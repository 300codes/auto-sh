# FLOW-F3 hand-over — report flow section and workflow seams (lane B, T058)

For Marcin (project workflow / Workflows Studio) and Adam (report UI). Contract source: FLOW-F0 delta in
`.ai/specs/2026-09-18-delivery-os-hackathon.md` (F4–F6, F15, D5–D7). Nothing here changes a frozen v1 contract.

## What the workflow does, in order

1. **Pin (F4)** — `POST /api/delivery_os/projects/:id/flow/pin` `{ templateId, templateVersion }` with the project
   `x-om-ext-optimistic-lock-expected-updated-at` header (feature `delivery_os.flow.manage`), or command
   `delivery_os.flow.pin` in-process. The template comes from DI `deliveryFlowTemplateProvider`; the full snapshot and
   its hash are stored on the project. Write-once: same id+version → `200` stored body **without consulting the
   provider**; another → `409 flow_already_pinned`. `422 unknown_flow_template` / `flow_template_hash_mismatch`.
2. **Link the instance (F5)** — command `delivery_os.flow.link_instance`
   `{ projectId, workflowInstanceId, definitionId, workflowId, version, trustedExecution }`, in-process only:
   `trustedExecution` must be the object returned by `issueTrustedExecution(actorUserId)` from
   `delivery_os/lib/trustedExecution.ts` (a copied/forged object and any HTTP-request context → `403 forbidden`, detail `trusted_execution_required`).
   Same instance → `changed: false`; another → `409 flow_already_pinned` / `instance_already_linked`; unpinned →
   `422 flow_not_pinned`. Link this long-running project instance only; the per-attempt workflow keeps using
   `attempts.link_workflow` — they are different ids.
3. **Poll status (F6)** — `GET /projects/:id/flow` (`delivery_os.projects.view`) or in-process
   `container.resolve('deliveryOsFlowQueries').flowStatus(projectId, { tenantId, organizationId })` →
   `FlowStatus v1` (`flowStatusV1Schema`). Waiting for a decision is durable: re-reading never starts an agent.
   Drive the next step from `nextAction.kind` + `stageId` and `pendingApprovals[]`.
4. **Dispatch only when `gates.dispatchable.ok`** — all four approval stages (`scope`, `ux`, `key_visual`,
   `design_system_ui`) `approved` and current, and no active attempt. It is advisory for the workflow: the backend
   enforces the same gate on task `ready`, attempt reserve (both modes) and deploy consent (v1 answer
   `422 baseline_not_approved` with `details[].path = stages.<id>`), so an old endpoint cannot bypass it.
   `gates.publishable` = same stage check without the attempt condition.
5. **Report (F15, this task)** — `GET /projects/:id/report` of a pinned project carries optional
   `flow { template, stages[4]{ stageId, currency, approvedArtifact, decisionId, clientApproved }, gate }`
   (`deliveryReportWithFlowSchema`). `decisionId` / `clientApproved` belong to the decision that approved
   `approvedArtifact` (both null/false while nothing is approved), so a newer rejected or pending version never
   borrows them; the current state is in `currency`. The section reflects the current stage state regardless of the
   `baselineId` / `revision` query. `flow.gate` has publishable semantics (stage blockers only; active attempts are
   not listed there). The v1 `gates.publishable/releasable` and `reportGateBlockerSchema.kind` are unchanged; legacy
   projects get the byte-identical v1 body without `flow`. A pinned project whose snapshot no longer parses gets a
   closed `flow.gate` (all stages `missing`) — never an absent section. In-process `deliveryOsReportQueries.buildReport`
   stays v1 unless called with `{ includeFlow: true }`.

## Provider contract (replace the OSS default)

```ts
// DI key 'deliveryFlowTemplateProvider' — commands/flowTemplateProvider.ts
getTemplate(templateId: string, version: number): Promise<FlowTemplateV1 | { template: FlowTemplateV1; hash: string } | null>
```

- Return only **published** versions; `null` → `422 unknown_flow_template`.
- Stating `hash` is recommended: it must equal `hashFlowTemplate(template)` (`lib/flowRules.ts`), else
  `422 flow_template_hash_mismatch`. A returned template whose id/version differ from the request → `unknown_flow_template`.
- Every semantic change (graph, conditions, executors, approvers, approval policy) must be a new `version`; the hash
  covers the whole template, so a changed condition alone changes the hash.
- Register it under the same DI key from the workflows-side module (`di.ts`). Awilix keeps the last registration for a key, so the overriding module must register after `delivery_os` — verify the module order in `apps/mercato/src/modules.ts` / the generated DI registry when wiring it, and add a test that `container.resolve('deliveryFlowTemplateProvider')` returns your provider.

**Example / proof:** `lib/fixtures/flow/fakes.ts` — `FAKE_TEMPLATE_V2` (an extra non-approval `content_review`
stage depending on UX, and a new condition on `implementation`; both change the hash, neither changes the four
approval stages) and `createFakeTemplateProvider()` (`publish` / `unpublish`, states the hash).
`api/__tests__/flowPin.route.test.ts` → "per-project pinning with a published v2": a v1-pinned project keeps its
snapshot/hash and F6 still reports v1 after v2 is published and v1 unpublished; a new project pins v2; a lying
provider hash is refused.

## Events for UI refresh

`delivery_os.stage.artifact_created` and `delivery_os.stage.decided` carry `clientBroadcast: true` and ids only
(guarded by `__tests__/module-registration.test.ts`); re-read F6/F15 on receipt.

## Evidence

- `yarn workspace @open-mercato/core jest src/modules/delivery_os --maxWorkers=2` (local runner) — result in FLOW-progress.md (T058).
- New: `api/__tests__/reportFlow.route.test.ts` (10, incl. a v1 body snapshot generated from the pre-change code),
  v2 pinning tests in `flowPin.route.test.ts` (2), provider DI test.

## Limitations / merge notes

- Lane B has no F2: `flow.gate` does not yet count open comment threads; lane A's `open_comments` seam feeds F6 and
  F8, and after merge the report section can pass `openThreadsByStage` the same way (not done here).
- `deliveryStaffKanbanAdapter` (F2, lane A) is not registered on this branch; the DI registration test lists the keys
  present here — after merge add it to the list in `commands/__tests__/attemptQueries.test.ts`.
- Live `GET /report` against the shared dev server was not run (that server runs lane A's code); run after merge.
