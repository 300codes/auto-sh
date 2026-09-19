import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DeliveryBaseline, DeliveryEvidence, DeliveryProject, DeliveryTask } from '../data/entities'
import { findAttempt, parseAttemptRegister } from '../lib/attempts'
import { buildDeliveryError, isSameRevision, resultManifestV1Schema, sourceRevisionSchema } from '../lib/contracts'
import { hashCanonical } from '../lib/hash'
import { resultReadResponseSchema, type ResultReadResponse } from '../lib/resultReadContracts'
import { deliveryHttpError, type DeliveryScope } from './shared'

function notFound() {
  return deliveryHttpError(buildDeliveryError('not_found', 'Not found', []))
}

function invalidResult() {
  return deliveryHttpError(buildDeliveryError('correlation_mismatch', 'Stored result does not match this attempt', []))
}

export function createDeliveryOsResultQueries(rootEm: EntityManager) {
  return {
    async read(scope: DeliveryScope, taskId: string, attemptId: string): Promise<ResultReadResponse> {
      if (!scope?.tenantId || !scope.organizationId) throw new Error('[internal] Result queries require tenant and organization')
      const em = rootEm.fork()
      const task = await findOneWithDecryption(em, DeliveryTask, { id: taskId, ...scope }, undefined, scope)
      if (!task) throw notFound()
      const project = await findOneWithDecryption(em, DeliveryProject, { id: task.projectId, ...scope }, undefined, scope)
      if (!project) throw notFound()
      const register = parseAttemptRegister(task.executionAttempts)
      if (!register.ok) throw deliveryHttpError(buildDeliveryError('reconciliation_required', 'Attempt register is unreadable', []))
      const attempt = findAttempt(register.register, attemptId)
      if (!attempt) throw notFound()
      if (!attempt.resultEvidenceId) return { schemaVersion: 'delivery-result-read.v1', result: null }
      const evidence = await findOneWithDecryption(em, DeliveryEvidence, {
        id: attempt.resultEvidenceId,
        projectId: task.projectId,
        taskId,
        attemptId,
        baselineId: attempt.baselineId,
        kind: 'result_manifest',
        ...scope,
      }, undefined, scope)
      if (!evidence) throw notFound()
      const baseline = await findOneWithDecryption(em, DeliveryBaseline, { id: attempt.baselineId, projectId: project.id, ...scope }, undefined, scope)
      if (!baseline) throw notFound()
      const parsed = resultManifestV1Schema.safeParse(evidence.payload)
      const revision = sourceRevisionSchema.safeParse(evidence.sourceRevision)
      if (!parsed.success || !revision.success) throw invalidResult()
      const manifest = parsed.data
      if (manifest.projectId !== project.id || manifest.taskId !== taskId || manifest.attemptId !== attemptId
        || manifest.baselineId !== attempt.baselineId || manifest.baselineHash !== attempt.baselineHash
        || baseline.contentHash !== attempt.baselineHash || manifest.targetProfileVersion !== task.targetProfileVersion
        || !isSameRevision(manifest.baseRevision, attempt.baseRevision)
        || !isSameRevision(manifest.resultRevision, revision.data)
        || manifest.externalRunId !== attempt.externalRunId
        || evidence.payloadHash !== hashCanonical(manifest)) throw invalidResult()
      return resultReadResponseSchema.parse({
        schemaVersion: 'delivery-result-read.v1',
        result: {
          projectId: project.id,
          taskId,
          attemptId,
          baselineId: attempt.baselineId,
          baselineHash: attempt.baselineHash,
          evidenceId: evidence.id,
          sourceRevision: revision.data,
          source: evidence.source,
          createdAt: evidence.createdAt.toISOString(),
          externalRunId: manifest.externalRunId,
          checks: manifest.checks.map(({ checkId, testId, acIds, status }) => ({ checkId, testId, acIds, status })),
          findings: manifest.findings,
          changedPaths: manifest.changedPaths,
          artifactCount: manifest.artifacts.length,
          artifactBytes: manifest.artifacts.some((artifact) => artifact.sizeBytes === undefined)
            ? null
            : manifest.artifacts.reduce((sum, artifact) => sum + (artifact.sizeBytes ?? 0), 0),
          usage: manifest.usage,
        },
      })
    },
  }
}

export type DeliveryOsResultQueries = ReturnType<typeof createDeliveryOsResultQueries>
