# OSS-06 — migration review (6.1) and evidence-history immutability (6.3)

## Migration review (throw-away DB `open_mercato_ossreview` on omhack postgres :5442)
- `DATABASE_URL=postgres://postgres:postgres@localhost:5442/open_mercato_ossreview yarn db:migrate` applied cleanly (the `[query_index] Could not read reindex declarations` lines are pre-existing CLI noise).
- Five tables present: delivery_projects, delivery_baselines, delivery_tasks, delivery_evidence, delivery_decisions.
- Every index/constraint below matches `Migration20260919003425_delivery_os.ts`; all scope indexes lead with `(tenant_id, organization_id, …)`:
  - baselines: unique `(tenant,org,project,content_hash)` and unique `(tenant,org,project,version)` (as constraints);
  - evidence: partial unique `delivery_evidence_result_manifest_uq` `WHERE kind = 'result_manifest'`, CHECK `delivery_evidence_result_manifest_attempt_chk`, three scope indexes;
  - tasks: partial unique `delivery_tasks_proposal_key_uq` `WHERE proposal_task_key IS NOT NULL`;
  - decisions/projects/tasks scope indexes.
- `yarn db:generate`: `delivery_os: no changes`. It emitted an unrelated `wms` migration + snapshot change; both were removed (file deleted, snapshot restored), git tree clean of them.
- Database dropped afterwards; the shared `open-mercato` DB was not touched.

### Raw catalog output
```
## indexes
delivery_baselines | delivery_baselines_pkey | CREATE UNIQUE INDEX delivery_baselines_pkey ON public.delivery_baselines USING btree (id)
delivery_baselines | delivery_baselines_project_hash_uq | CREATE UNIQUE INDEX delivery_baselines_project_hash_uq ON public.delivery_baselines USING btree (tenant_id, organization_id, project_id, content_hash)
delivery_baselines | delivery_baselines_project_version_uq | CREATE UNIQUE INDEX delivery_baselines_project_version_uq ON public.delivery_baselines USING btree (tenant_id, organization_id, project_id, version)
delivery_decisions | delivery_decisions_pkey | CREATE UNIQUE INDEX delivery_decisions_pkey ON public.delivery_decisions USING btree (id)
delivery_decisions | delivery_decisions_scope_project_kind_decided_idx | CREATE INDEX delivery_decisions_scope_project_kind_decided_idx ON public.delivery_decisions USING btree (tenant_id, organization_id, project_id, kind, decided_at)
delivery_evidence | delivery_evidence_pkey | CREATE UNIQUE INDEX delivery_evidence_pkey ON public.delivery_evidence USING btree (id)
delivery_evidence | delivery_evidence_result_manifest_uq | CREATE UNIQUE INDEX delivery_evidence_result_manifest_uq ON public.delivery_evidence USING btree (tenant_id, organization_id, task_id, attempt_id) WHERE (kind = 'result_manifest'::text)
delivery_evidence | delivery_evidence_scope_project_kind_hash_idx | CREATE INDEX delivery_evidence_scope_project_kind_hash_idx ON public.delivery_evidence USING btree (tenant_id, organization_id, project_id, kind, payload_hash)
delivery_evidence | delivery_evidence_scope_project_kind_idx | CREATE INDEX delivery_evidence_scope_project_kind_idx ON public.delivery_evidence USING btree (tenant_id, organization_id, project_id, kind)
delivery_evidence | delivery_evidence_scope_task_idx | CREATE INDEX delivery_evidence_scope_task_idx ON public.delivery_evidence USING btree (tenant_id, organization_id, task_id)
delivery_projects | delivery_projects_pkey | CREATE UNIQUE INDEX delivery_projects_pkey ON public.delivery_projects USING btree (id)
delivery_projects | delivery_projects_scope_created_idx | CREATE INDEX delivery_projects_scope_created_idx ON public.delivery_projects USING btree (tenant_id, organization_id, created_at)
delivery_projects | delivery_projects_scope_deleted_idx | CREATE INDEX delivery_projects_scope_deleted_idx ON public.delivery_projects USING btree (tenant_id, organization_id, deleted_at)
delivery_tasks | delivery_tasks_pkey | CREATE UNIQUE INDEX delivery_tasks_pkey ON public.delivery_tasks USING btree (id)
delivery_tasks | delivery_tasks_proposal_key_uq | CREATE UNIQUE INDEX delivery_tasks_proposal_key_uq ON public.delivery_tasks USING btree (tenant_id, organization_id, project_id, baseline_id, proposal_task_key) WHERE (proposal_task_key IS NOT NULL)
delivery_tasks | delivery_tasks_scope_project_deleted_idx | CREATE INDEX delivery_tasks_scope_project_deleted_idx ON public.delivery_tasks USING btree (tenant_id, organization_id, project_id, deleted_at)
## constraints
delivery_baselines | delivery_baselines_project_hash_uq | UNIQUE (tenant_id, organization_id, project_id, content_hash)
delivery_baselines | delivery_baselines_project_version_uq | UNIQUE (tenant_id, organization_id, project_id, version)
delivery_evidence | delivery_evidence_result_manifest_attempt_chk | CHECK (((kind <> 'result_manifest'::text) OR ((task_id IS NOT NULL) AND (attempt_id IS NOT NULL))))
```

## Append-only audit (6.3)
`packages/core/src/modules/delivery_os/commands/__tests__/appendOnly.test.ts`:
1. Static scan of every non-test file under `commands/` (all imports of `commands/index.ts` verified present) and `api/` (16 route files): no `remove`/`removeAndFlush`/`nativeDelete`, `undo`, `assign(`, `nativeUpdate(Delivery{Baseline,Evidence,Decision})`, or property assignment on baseline/evidence/decision variables. Known benign `url.searchParams.delete` excluded.
2. Scanner self-test: 8 synthetic update/delete/undo lines are flagged; commented-out code and `tx.create` are not.
3. Full publication flow through the real routes/commands (project → baseline → decisions → task → reserve → result import + duplicate → review + replay → deployment evidence → deploy consent → release). After every step every existing baseline/evidence/decision row is compared with its earlier JSON snapshot; `remove`/`removeAndFlush`/`nativeDelete`/`assign` spies are never called and `nativeUpdate` never targets a history entity.
- Negative demo: temporarily appended `decision.verdict = "rejected"; tx.nativeDelete(DeliveryDecision, {})` to `commands/decisions.ts` → the static-scan test failed (flagged lines 569–571); reverted, 4/4 pass.
- Run: `yarn workspace @open-mercato/core jest src/modules/delivery_os/commands/__tests__/appendOnly.test.ts --maxWorkers=2`.
- Limit: the runtime snapshot check catches in-memory rewrites in the route test store, not SQL-level updates; the static scan covers those.
