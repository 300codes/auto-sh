import { z } from 'zod'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { DeliveryEvidence, DeliveryReleaseCandidate } from '../data/entities'
import { isSameRevision, uuidSchema } from '../lib/contracts'
import { nominateReleaseCandidateSchema, releaseCandidateResponseSchema } from '../lib/reportContracts'
import { reportContextError } from './reportContext'
import { createDeliveryOsReportQueries } from './reportQueries'
import { DELIVERY_PROJECT_RESOURCE_KIND, lockProjectForWrite, lockScopedProjectTasks, parseDeliveryInput, requireActorUserId, requireLockHeader, resolveDeliveryEm, resolveDeliveryScope } from './shared'

const commandSchema = nominateReleaseCandidateSchema.extend({ projectId: uuidSchema })
export type CandidateCommandResult = z.infer<typeof releaseCandidateResponseSchema>
const nominateCandidate: CommandHandler<z.infer<typeof commandSchema>, CandidateCommandResult> = {
  id: 'delivery_os.release_candidates.nominate',
  async execute(rawInput, ctx) {
    const input = parseDeliveryInput(commandSchema, rawInput)
    const scope = resolveDeliveryScope(ctx)
    const actor = requireActorUserId(ctx)
    requireLockHeader(ctx)
    const em = resolveDeliveryEm(ctx)
    const result = await em.transactional(async (tx) => {
      const project = await lockProjectForWrite(tx, ctx, input.projectId, scope, { force: true })
      await lockScopedProjectTasks(tx, project.id, scope)
      if (project.activeBaselineId !== input.baselineId) reportContextError('baseline_not_active', 422)
      const report = await createDeliveryOsReportQueries(tx, true).buildReport(scope, project.id, { baselineId: input.baselineId, revision: input.sourceRevision })
      const evidence = await findWithDecryption(tx, DeliveryEvidence, { ...scope, projectId: project.id, baselineId: input.baselineId, id: { $in: input.evidenceIds } }, undefined, scope)
      if (evidence.length !== input.evidenceIds.length || evidence.some((row) => !row.sourceRevision || !isSameRevision(row.sourceRevision, input.sourceRevision))) reportContextError('candidate_evidence_mismatch', 422)
      if (!evidence.some((row) => row.kind === 'test' && !row.taskId && !!row.rawReportHash)) reportContextError('candidate_integration_evidence_required', 422)
      if (!report.gates.publishable.ok) reportContextError('report_not_green', 422)
      if (report.mode === 'flow' && !report.flow?.gate.ok) reportContextError('flow_not_publishable', 422)
      const previous = report.currentCandidate
      const createdAt = new Date(Math.max(Date.now(), project.updatedAt.getTime() + 1))
      const candidate = tx.create(DeliveryReleaseCandidate, { ...scope, projectId: project.id, version: (previous?.version ?? 0) + 1, baselineId: input.baselineId, baselineHash: report.baselineHash, sourceRevision: input.sourceRevision, evidenceIds: [...input.evidenceIds].sort((left, right) => left < right ? -1 : left > right ? 1 : 0), createdBy: actor, createdAt })
      tx.persist(candidate)
      project.updatedAt = createdAt
      await tx.flush()
      return { project, candidate }
    })
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({ dataEngine, action: 'created', entity: result.candidate, identifiers: { id: result.candidate.id, ...scope }, indexer: { entityType: 'delivery_os:delivery_release_candidate' } })
    await emitCrudSideEffects({ dataEngine, action: 'updated', entity: result.project, identifiers: { id: result.project.id, ...scope }, indexer: { entityType: 'delivery_os:delivery_project' } })
    return releaseCandidateResponseSchema.parse({ currentCandidate: { ...result.candidate, createdAt: result.candidate.createdAt.toISOString() }, projectUpdatedAt: result.project.updatedAt.toISOString() })
  },
  async buildLog({ result, ctx }) {
    const scope = resolveDeliveryScope(ctx)
    const { translate } = await resolveTranslations()
    return { actionLabel: translate('delivery_os.audit.candidates.nominate', 'Nominate release candidate'), resourceKind: DELIVERY_PROJECT_RESOURCE_KIND, resourceId: result.currentCandidate!.projectId, ...scope, snapshotAfter: result }
  },
}
registerCommand(nominateCandidate)
