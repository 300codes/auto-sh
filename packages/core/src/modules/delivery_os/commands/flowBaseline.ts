import { E } from '#generated/entities.ids.generated'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DeliveryFlowBaselineBinding, type DeliveryBaseline, type DeliveryProject } from '../data/entities'
import { draftSpecV1Schema } from '../data/validators'
import { flowBaselineMaterializeSchema, flowBaselineProvenanceSchema, flowRefsHash, materializeFlowDraft } from '../lib/flowBaseline'
import { hashCanonical } from '../lib/hash'
import { isFlowPinned, loadStageArtifactRows } from './flowGate'
import { currentFlowRefs, flowBaselineFailure } from './flowExecutionGate'
import { deliveryHttpError, lockProjectForWrite, parseDeliveryInput, resolveDeliveryEm, resolveDeliveryScope, requireLockHeader, requireScopedProject, type DeliveryScope } from './shared'

export async function bindFlowBaseline(tx: EntityManager, project: DeliveryProject, baseline: DeliveryBaseline, scope: DeliveryScope, actorId: string | null): Promise<void> {
  if (!isFlowPinned(project)) return
  const provenance = flowBaselineProvenanceSchema.safeParse(project.draftSpec.flowBaseline)
  const stageRefs = await currentFlowRefs(tx, project, scope)
  const draft = draftSpecV1Schema.parse(project.draftSpec)
  if (!provenance.success || provenance.data.templateHash !== project.flowTemplateHash || provenance.data.draftHash !== hashCanonical(draft) || flowRefsHash(provenance.data.stageRefs) !== flowRefsHash(stageRefs)) {
    throw deliveryHttpError(flowBaselineFailure('flow_baseline_draft_stale'))
  }
  const identity = { tenantId: scope.tenantId, organizationId: scope.organizationId, projectId: project.id, baselineId: baseline.id, templateHash: provenance.data.templateHash, refsHash: flowRefsHash(stageRefs) }
  if (await findOneWithDecryption(tx, DeliveryFlowBaselineBinding, identity, undefined, scope)) return
  tx.persist(tx.create(DeliveryFlowBaselineBinding, { id: randomUUID(), ...identity, stageRefs, createdBy: actorId }))
}

/**
 * Re-binds a merged baseline after a command rewrote the draft. A plan import keeps the same approved stages but adds
 * its plan to the draft, so the stored provenance no longer matches; without refreshing it the merged baseline would
 * carry no binding and every task on it would fail the execution gate with `flow_baseline_binding_missing`.
 */
export async function rebindFlowBaseline(tx: EntityManager, project: DeliveryProject, baseline: DeliveryBaseline, scope: DeliveryScope, actorId: string | null): Promise<void> {
  if (!isFlowPinned(project)) return
  const stageRefs = await currentFlowRefs(tx, project, scope)
  const draft = draftSpecV1Schema.parse(project.draftSpec)
  const provenance = { templateHash: project.flowTemplateHash!, stageRefs, draftHash: hashCanonical(draft) }
  project.draftSpec = { ...project.draftSpec, flowBaseline: provenance }
  const identity = { tenantId: scope.tenantId, organizationId: scope.organizationId, projectId: project.id, baselineId: baseline.id, templateHash: provenance.templateHash, refsHash: flowRefsHash(stageRefs) }
  if (await findOneWithDecryption(tx, DeliveryFlowBaselineBinding, identity, undefined, scope)) return
  tx.persist(tx.create(DeliveryFlowBaselineBinding, { id: randomUUID(), ...identity, stageRefs, createdBy: actorId }))
}

export type FlowBaselineResult = { projectId: string; projectUpdatedAt: string; templateHash: string; stageRefs: Awaited<ReturnType<typeof currentFlowRefs>>; draftHash: string }

const materialize: CommandHandler<unknown, FlowBaselineResult> = {
  id: 'delivery_os.flow.materialize_baseline',
  async execute(rawInput, ctx) {
    const { projectId } = parseDeliveryInput(flowBaselineMaterializeSchema, rawInput)
    const scope = resolveDeliveryScope(ctx)
    requireLockHeader(ctx)
    await requireScopedProject(resolveDeliveryEm(ctx), projectId, scope)
    const outcome = await resolveDeliveryEm(ctx).transactional(async (tx) => {
      const project = await lockProjectForWrite(tx, ctx, projectId, scope, { force: true })
      const stageRefs = await currentFlowRefs(tx, project, scope)
      const rows = await loadStageArtifactRows(tx, project.id, scope)
      const content = (stageId: string) => rows.find((row) => row.id === stageRefs.find((ref) => ref.stageId === stageId)?.artifactId)?.content
      const draft = materializeFlowDraft(content('scope'), content('design_system_ui'))
      const importMetadata = {
        ...(project.draftSpec.designImportSessionId ? { designImportSessionId: project.draftSpec.designImportSessionId } : {}),
        ...(project.draftSpec.manifestHash ? { manifestHash: project.draftSpec.manifestHash } : {}),
      }
      const versionedDraft = draftSpecV1Schema.parse({ ...draft, ...importMetadata })
      const provenance = { templateHash: project.flowTemplateHash!, stageRefs, draftHash: hashCanonical(versionedDraft) }
      project.draftSpec = { ...versionedDraft, ...importMetadata, flowBaseline: provenance }
      project.updatedAt = new Date()
      tx.persist(project)
      return { project, result: { projectId, projectUpdatedAt: project.updatedAt.toISOString(), ...provenance } }
    })
    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'updated', entity: outcome.project,
      identifiers: { id: projectId, tenantId: scope.tenantId, organizationId: scope.organizationId },
      indexer: { entityType: E.delivery_os.delivery_project },
    })
    return outcome.result
  },
}
registerCommand(materialize)
