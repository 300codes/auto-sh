import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { attachDeliveryEvidence, requireDeliveryResource, withDeliveryFixture } from '@open-mercato/core/helpers/integration/deliveryEvidence'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { baselineCreateResponseSchema, baselineListResponseSchema, planImportResponseSchema, taskListResponseSchema } from '../api/schemas'
import planProposalJson from '../lib/fixtures/plan-proposal.v1.json' with { type: 'json' }
import requirementsProposalJson from '../lib/fixtures/requirements-proposal.v1.json' with { type: 'json' }
import { hashCanonical } from '../lib/hash'
import { planProposalV1Schema, requirementsProposalV1Schema, type PlanProposalV1 } from '../lib/contracts'

test.describe('TC-DELIVERY-003: requirements and plan proposals', () => {
  for (const inputMode of ['from_brief', 'from_design'] as const) {
    test(`${inputMode}: proposals replay without duplication and merged baseline requires new decisions`, async ({}, testInfo) => {
      await withDeliveryFixture(testInfo, async (fixture) => {
        const actor = requireDeliveryResource(fixture.operators.A1)
        const project = await fixture.createProject(actor, inputMode, { inputMode })
        const draft = await fixture.uploadDraft(project)
        const baselinePath = `/api/delivery_os/projects/${project.id}/baselines`
        const taskPath = `/api/delivery_os/projects/${project.id}/tasks`
        const requirements = { ...requirementsProposalV1Schema.parse(requirementsProposalJson), projectId: project.id, manifestId: `requirements-${randomUUID()}` }
        const current = await fixture.readProject(project)
        const imported = await fixture.request(actor, 'POST', baselinePath, {
          data: { source: 'requirements_proposal', manifest: requirements }, updatedAt: current.updatedAt ?? undefined,
        })
        expect(imported.status()).toBe(201)
        const baseline = baselineCreateResponseSchema.parse(await readJsonSafe(imported))
        fixture.ledger.retain({ kind: 'baseline', id: baseline.baselineId, tenantId: project.tenantId, organizationId: project.organizationId })
        const snapshots = baselineListResponseSchema.parse(await readJsonSafe(await fixture.request(actor, 'GET', baselinePath)))
        expect(snapshots.items).toHaveLength(1)
        expect(snapshots.items[0]).toMatchObject({ id: baseline.baselineId, source: 'requirements_proposal', contentHash: baseline.contentHash })
        expect(snapshots.items[0].content.requirements).toEqual(requirements.requirements)
        expect(snapshots.items[0].content.acceptanceCriteria).toEqual(requirements.acceptanceCriteria)
        expect(snapshots.items[0].attachmentIds).toContain(draft.screens[0].attachmentId)
        expect(hashCanonical(snapshots.items[0].content)).toBe(baseline.contentHash)
        for (const updatedAt of [undefined, current.updatedAt ?? undefined]) {
          const replay = await fixture.request(actor, 'POST', baselinePath, { data: { source: 'requirements_proposal', manifest: requirements }, updatedAt })
          expect(replay.status()).toBe(200)
          expect(baselineCreateResponseSchema.parse(await readJsonSafe(replay))).toMatchObject({ baselineId: baseline.baselineId, duplicate: true })
        }
        const conflicting = await fixture.request(actor, 'POST', baselinePath, {
          data: { source: 'requirements_proposal', manifest: { ...requirements, requirements: requirements.requirements.map((requirement, index) => index === 0 ? { ...requirement, title: 'Conflicting proposal title' } : requirement) } }, expectedStatus: 409,
        })
        expect(conflicting.status()).toBe(409)
        expect(await readJsonSafe(conflicting)).toMatchObject({ code: 'idempotency_conflict' })
        expect(baselineListResponseSchema.parse(await readJsonSafe(await fixture.request(actor, 'GET', baselinePath))).items).toEqual(snapshots.items)

        const plan = { ...planProposalV1Schema.parse(planProposalJson), projectId: project.id, baselineId: baseline.baselineId, baselineHash: baseline.contentHash, manifestId: `plan-${randomUUID()}` }
        const unapprovedVersion = await fixture.readProject(project)
        const unapproved = await fixture.request(actor, 'POST', taskPath, {
          data: { source: 'plan_proposal', manifest: plan }, updatedAt: unapprovedVersion.updatedAt ?? undefined, expectedStatus: 422,
        })
        expect(unapproved.status()).toBe(422)
        expect(await readJsonSafe(unapproved)).toMatchObject({ code: 'baseline_not_approved' })
        await fixture.decideBaseline(project, baseline, 'requirements')
        await fixture.decideBaseline(project, baseline, 'design')
        const approved = await fixture.readProject(project)
        for (const lock of [{ updatedAt: undefined, status: 428, code: 'optimistic_lock_required' }, { updatedAt: current.updatedAt ?? undefined, status: 409, code: 'optimistic_lock_conflict' }]) {
          const denied = await fixture.request(actor, 'POST', taskPath, {
            data: { source: 'plan_proposal', manifest: plan }, updatedAt: lock.updatedAt, expectedStatus: lock.status,
          })
          const body = await readJsonSafe(denied)
          await attachDeliveryEvidence(testInfo, `plan-lock-${lock.status}`, { status: denied.status(), body })
          expect(denied.status()).toBe(lock.status)
          expect(body).toMatchObject({ code: lock.code })
        }
        const planResponse = await fixture.request(actor, 'POST', taskPath, {
          data: { source: 'plan_proposal', manifest: plan }, updatedAt: approved.updatedAt ?? undefined,
        })
        const mutation = { method: 'POST', path: taskPath, status: planResponse.status(), ids: [] as string[] }
        if (planResponse.ok()) fixture.unmanagedMutations.push(mutation)
        const merged = planImportResponseSchema.parse(await readJsonSafe(planResponse))
        await fixture.trackTasks(project, merged.tasks.map((task) => task.id))
        const mutationIndex = fixture.unmanagedMutations.indexOf(mutation)
        if (mutationIndex >= 0) fixture.unmanagedMutations.splice(mutationIndex, 1)
        expect(planResponse.status()).toBe(201)
        fixture.ledger.retain({ kind: 'baseline', id: merged.baselineId, tenantId: project.tenantId, organizationId: project.organizationId })
        expect(merged.baselineId).not.toBe(baseline.baselineId)
        expect(merged.tasks.map((task) => task.proposalTaskKey)).toEqual(['service-list', 'service-filter'])
        const storedTasks = taskListResponseSchema.parse(await readJsonSafe(await fixture.request(actor, 'GET', taskPath)))
        expect(storedTasks.items).toHaveLength(2)
        const first = requireDeliveryResource(merged.tasks.find((task) => task.proposalTaskKey === 'service-list'))
        const second = requireDeliveryResource(merged.tasks.find((task) => task.proposalTaskKey === 'service-filter'))
        expect((await fixture.readTask(actor, second.id)).dependsOnTaskIds).toEqual([first.id])
        for (const updatedAt of [undefined, approved.updatedAt ?? undefined]) {
          const replay = await fixture.request(actor, 'POST', taskPath, { data: { source: 'plan_proposal', manifest: plan }, updatedAt })
          expect(replay.status()).toBe(200)
          expect(planImportResponseSchema.parse(await readJsonSafe(replay))).toMatchObject({ baselineId: merged.baselineId, duplicate: true, tasks: merged.tasks })
        }
        const planConflict = await fixture.request(actor, 'POST', taskPath, {
          data: { source: 'plan_proposal', manifest: { ...plan, architectureSummary: 'Changed payload under the same plan manifest ID' } }, expectedStatus: 409,
        })
        expect(planConflict.status()).toBe(409)
        expect(await readJsonSafe(planConflict)).toMatchObject({ code: 'idempotency_conflict' })
        expect(taskListResponseSchema.parse(await readJsonSafe(await fixture.request(actor, 'GET', taskPath))).items).toEqual(storedTasks.items)
        const allBaselines = baselineListResponseSchema.parse(await readJsonSafe(await fixture.request(actor, 'GET', baselinePath)))
        expect(allBaselines.items).toHaveLength(2)
        const mergedSnapshot = requireDeliveryResource(allBaselines.items.find((entry) => entry.id === merged.baselineId))
        expect(mergedSnapshot).toMatchObject({ source: 'plan_proposal', parentBaselineId: baseline.baselineId })
        expect(hashCanonical(mergedSnapshot.content)).toBe(merged.contentHash)
        for (const kind of ['requirements', 'design'] as const) {
          const task = await fixture.readTask(actor, first.id)
          const denied = await fixture.request(actor, 'PUT', '/api/delivery_os/tasks', { data: { id: first.id, status: 'ready' }, updatedAt: task.updatedAt, expectedStatus: 422 })
          expect(denied.status()).toBe(422)
          expect(await readJsonSafe(denied)).toMatchObject({ code: 'baseline_not_approved' })
          expect((await fixture.readTask(actor, first.id)).executionAttempts).toEqual([])
          await fixture.decideBaseline(project, merged, kind)
        }
        const reservation = await fixture.reserveNeverDispatched(first.id)
        expect(reservation.taskPackage).toMatchObject({ baselineId: merged.baselineId, baselineHash: merged.contentHash })
        expect((await fixture.readProject(project)).activeBaselineId).toBe(merged.baselineId)
        await attachDeliveryEvidence(testInfo, 'proposal-pipeline', { inputMode, projectId: project.id, requirementsManifestId: requirements.manifestId, planManifestId: plan.manifestId, originalBaseline: baseline, mergedBaseline: merged, taskId: first.id, attemptId: reservation.attemptId, provenance: 'http-fixture' })
      })
    })

    test(`${inputMode}: invalid requirements and plan manifests leave no new baselines or tasks`, async ({}, testInfo) => {
      await withDeliveryFixture(testInfo, async (fixture) => {
        const actor = requireDeliveryResource(fixture.operators.A1)
        const project = await fixture.createProject(actor, inputMode, { inputMode })
        const baseline = await fixture.prepareBaseline(project)
        const current = await fixture.readProject(project)
        const baselinePath = `/api/delivery_os/projects/${project.id}/baselines`
        const taskPath = `/api/delivery_os/projects/${project.id}/tasks`
        const before = baselineListResponseSchema.parse(await readJsonSafe(await fixture.request(actor, 'GET', baselinePath)))
        const requirements = { ...requirementsProposalV1Schema.parse(requirementsProposalJson), projectId: project.id, manifestId: `requirements-negative-${randomUUID()}` }
        const requirementCases = [
          { name: 'requirements-version', code: 'unsupported_schema_version', manifest: { ...requirements, schemaVersion: 'delivery.requirements-proposal/v99' } },
          { name: 'requirements-foreign-project', code: 'foreign_reference', manifest: { ...requirements, projectId: randomUUID() } },
          { name: 'requirements-duplicate-id', code: 'duplicate_stable_id', manifest: { ...requirements, requirements: [...requirements.requirements, requirements.requirements[0]] } },
          { name: 'requirements-missing-ac', code: 'missing_acceptance_criteria', manifest: { ...requirements, acceptanceCriteria: [] } },
        ]
        for (const scenario of requirementCases) {
          const response = await fixture.request(actor, 'POST', baselinePath, {
            data: { source: 'requirements_proposal', manifest: scenario.manifest }, updatedAt: current.updatedAt ?? undefined, expectedStatus: 422,
          })
          const body = await readJsonSafe(response)
          await attachDeliveryEvidence(testInfo, scenario.name, { status: response.status(), body, projectId: project.id })
          expect(response.status()).toBe(422)
          expect(body).toMatchObject({ code: scenario.code })
          expect(await fixture.readProject(project)).toEqual(current)
        }
        const plan: PlanProposalV1 = { ...planProposalV1Schema.parse(planProposalJson), projectId: project.id, baselineId: baseline.baselineId, baselineHash: baseline.contentHash, manifestId: `plan-negative-${randomUUID()}` }
        const changePaths = (path: string) => ({ ...plan, tasks: plan.tasks.map((task, index) => index === 0 ? { ...task, allowedPaths: [path] } : task) })
        const planCases = [
          { name: 'plan-version', code: 'unsupported_schema_version', manifest: { ...plan, schemaVersion: 'delivery.plan-proposal/v99' } },
          { name: 'plan-foreign-baseline', code: 'foreign_reference', manifest: { ...plan, baselineId: randomUUID() } },
          { name: 'plan-baseline-hash', code: 'foreign_reference', manifest: { ...plan, baselineHash: '0'.repeat(64) } },
          { name: 'plan-absolute-path', code: 'path_not_allowed', manifest: changePaths('/src/**') },
          { name: 'plan-traversal-path', code: 'path_not_allowed', manifest: changePaths('src/../private/**') },
          { name: 'plan-outside-profile', code: 'path_not_allowed', manifest: changePaths('private/**') },
          { name: 'plan-unknown-ac', code: 'unknown_ac', manifest: { ...plan, tasks: plan.tasks.map((task, index) => index === 0 ? { ...task, acIds: ['AC-unknown'] } : task) } },
          { name: 'plan-unknown-test', code: 'unknown_test_id', manifest: { ...plan, acTestMap: { ...plan.acTestMap, 'AC-001': ['undeclared-fixture-test'] } } },
          { name: 'plan-cycle', code: 'cycle', manifest: { ...plan, tasks: plan.tasks.map((task, index) => index === 0 ? { ...task, dependsOn: ['service-filter'] } : task) } },
        ]
        for (const scenario of planCases) {
          const response = await fixture.request(actor, 'POST', taskPath, {
            data: { source: 'plan_proposal', manifest: scenario.manifest }, updatedAt: current.updatedAt ?? undefined, expectedStatus: 422,
          })
          const body = await readJsonSafe(response)
          const afterTasks = taskListResponseSchema.parse(await readJsonSafe(await fixture.request(actor, 'GET', taskPath)))
          await attachDeliveryEvidence(testInfo, scenario.name, { status: response.status(), body, taskCount: afterTasks.total, baselineId: baseline.baselineId })
          expect(response.status()).toBe(422)
          expect(body).toMatchObject({ code: scenario.code })
          expect(afterTasks.items).toEqual([])
          expect(await fixture.readProject(project)).toEqual(current)
        }
        expect(baselineListResponseSchema.parse(await readJsonSafe(await fixture.request(actor, 'GET', baselinePath)))).toEqual(before)
      })
    })
  }
})
