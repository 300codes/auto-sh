import type { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { DeliveryIntake, type DeliveryProject } from '../data/entities'
import {
  intakeUpdateCommandSchema,
  scopingProposalImportCommandSchema,
  type IntakeUpdateCommandInput,
  type ScopingProposalImportCommandInput,
} from '../data/validators'
import {
  DELIVERY_FLOW_SCHEMA_VERSIONS,
  buildDeliveryError,
  scopingProposalImportResponseSchema,
  uuidSchema,
  type AttachmentRef,
  type ImportedManifest,
  type IntakeResponse,
  type IntakeV1,
} from '../lib/contracts'
import { applyIntakeUpdate, mergeScopingProposal, type IntakeProjectContext } from '../lib/intakeRules'
import { isIssuedTrustedExecution, readTrustedExecutionOption } from '../lib/trustedExecution'
import { verifyAttachmentReferences } from './attachments'
import {
  assertDeliveryCheck,
  DELIVERY_INTAKE_RESOURCE_KIND,
  deliveryFlowHttpError,
  deliveryHttpError,
  findScopedIntake,
  lockScopedProject,
  parseDeliveryInput,
  requireLockHeader,
  requireScopedProject,
  resolveDeliveryEm,
  resolveDeliveryScope,
  type DeliveryScope,
} from './shared'

export type IntakeUpdateCommandResult = IntakeResponse
export type ScopingProposalImportCommandResult = z.infer<typeof scopingProposalImportResponseSchema>

type IntakeAuditSnapshot = {
  projectId: string
  tenantId: string
  organizationId: string
  step: string
  questionCount: number
  proposalIds: string[]
  platformChosen: { profileId: string; profileVersion: number } | null
  updatedAt: string
}

function toIntakeDocument(row: DeliveryIntake): IntakeV1 {
  return {
    schemaVersion: DELIVERY_FLOW_SCHEMA_VERSIONS.intake,
    projectId: row.projectId,
    step: row.step,
    brief: row.brief,
    questions: row.questions,
    proposals: row.proposals,
    platform: row.platform,
    tools: row.tools,
  }
}

function projectContext(project: DeliveryProject): IntakeProjectContext {
  return { projectId: project.id, targetProfileId: project.targetProfileId, targetProfileVersion: project.targetProfileVersion }
}

function intakeVersion(intakeRow: DeliveryIntake | null, project: DeliveryProject): Date {
  return intakeRow?.updatedAt ?? project.createdAt
}

function toIntakeResponse(intake: IntakeV1, project: DeliveryProject, updatedAt: Date): IntakeResponse {
  return {
    intake,
    targetProfile: { profileId: project.targetProfileId, profileVersion: project.targetProfileVersion },
    updatedAt: updatedAt.toISOString(),
  }
}

function auditSnapshot(scope: DeliveryScope, response: IntakeResponse): IntakeAuditSnapshot {
  return {
    projectId: response.intake.projectId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    step: response.intake.step,
    questionCount: response.intake.questions.length,
    proposalIds: response.intake.proposals.map((proposal) => proposal.proposalId),
    platformChosen: response.intake.platform.chosen
      ? { profileId: response.intake.platform.chosen.profileId, profileVersion: response.intake.platform.chosen.profileVersion }
      : null,
    updatedAt: response.updatedAt,
  }
}

function resolveIntakeActor(ctx: CommandRuntimeContext, trustedActorId: string | undefined): string | null {
  const parsed = uuidSchema.safeParse(ctx.auth?.sub)
  if (parsed.success) return parsed.data
  return trustedActorId ?? null
}

function trustedExecutionRequired(): ReturnType<typeof deliveryHttpError> {
  return deliveryHttpError(
    buildDeliveryError('forbidden', 'The trusted execution option is reserved for the in-process scoping agent', [
      { path: 'trustedExecution', code: 'trusted_execution_required' },
    ]),
  )
}

function materialReferences(materials: readonly AttachmentRef[]) {
  return materials.map((material, index) => ({
    path: `brief.materials.${index}`,
    role: 'attachment' as const,
    attachmentId: material.attachmentId,
    declared: { sha256: material.sha256, sizeBytes: material.sizeBytes, mimeType: material.mimeType },
  }))
}

async function enforceIntakeLock(
  ctx: CommandRuntimeContext,
  intakeRow: DeliveryIntake | null,
  project: DeliveryProject,
): Promise<void> {
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: DELIVERY_INTAKE_RESOURCE_KIND,
    resourceId: project.id,
    current: intakeVersion(intakeRow, project),
    request: ctx.request ?? null,
  })
}

type IntakeWrite = {
  intake: IntakeV1
  importedManifests?: ImportedManifest[]
}

function writeIntake(
  tx: EntityManager,
  scope: DeliveryScope,
  project: DeliveryProject,
  intakeRow: DeliveryIntake | null,
  write: IntakeWrite,
  createdBy: string | null,
  now: Date,
): DeliveryIntake {
  if (intakeRow) {
    intakeRow.step = write.intake.step
    intakeRow.brief = write.intake.brief
    intakeRow.questions = write.intake.questions
    intakeRow.proposals = write.intake.proposals
    intakeRow.platform = write.intake.platform
    intakeRow.tools = write.intake.tools
    if (write.importedManifests) intakeRow.importedManifests = write.importedManifests
    intakeRow.updatedAt = now
    return intakeRow
  }
  const created = tx.create(DeliveryIntake, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    projectId: project.id,
    schemaVersion: DELIVERY_FLOW_SCHEMA_VERSIONS.intake,
    step: write.intake.step,
    brief: write.intake.brief,
    questions: write.intake.questions,
    proposals: write.intake.proposals,
    platform: write.intake.platform,
    tools: write.intake.tools,
    importedManifests: write.importedManifests ?? [],
    createdBy,
    createdAt: now,
    updatedAt: now,
  })
  tx.persist(created)
  return created
}

const updateIntakeCommand: CommandHandler<IntakeUpdateCommandInput, IntakeUpdateCommandResult> = {
  id: 'delivery_os.intake.update',
  async execute(rawInput, ctx) {
    const scope = resolveDeliveryScope(ctx)
    const parsed = parseDeliveryInput(intakeUpdateCommandSchema, rawInput)
    requireLockHeader(ctx)
    const actor = resolveIntakeActor(ctx, undefined)

    const probeEm = resolveDeliveryEm(ctx)
    await requireScopedProject(probeEm, parsed.projectId, scope)
    assertDeliveryCheck(await verifyAttachmentReferences(probeEm, ctx, materialReferences(parsed.intake.brief.materials), scope))

    const em = resolveDeliveryEm(ctx)
    const outcome = await em.transactional(async (tx) => {
      const project = await lockScopedProject(tx, parsed.projectId, scope)
      const intakeRow = await findScopedIntake(tx, project.id, scope, { lock: true })
      await enforceIntakeLock(ctx, intakeRow, project)
      const applied = applyIntakeUpdate({
        stored: intakeRow ? toIntakeDocument(intakeRow) : null,
        request: parsed.intake,
        project: projectContext(project),
      })
      if (!applied.ok) throw deliveryFlowHttpError(applied)
      const written = writeIntake(tx, scope, project, intakeRow, { intake: applied.intake }, actor, new Date())
      return { intake: applied.intake, project, written }
    })
    return toIntakeResponse(outcome.intake, outcome.project, outcome.written.updatedAt)
  },
  buildLog: async ({ result, ctx }) => {
    const scope = resolveDeliveryScope(ctx)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('delivery_os.audit.intake.update', 'Update delivery intake'),
      resourceKind: DELIVERY_INTAKE_RESOURCE_KIND,
      resourceId: result.intake.projectId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      snapshotAfter: auditSnapshot(scope, result),
    }
  },
}

function toImportResult(
  project: DeliveryProject,
  manifestId: string,
  manifestHash: string,
  duplicate: boolean,
  updatedAt: Date,
): ScopingProposalImportCommandResult {
  return scopingProposalImportResponseSchema.parse({
    projectId: project.id,
    manifestId,
    manifestHash,
    duplicate,
    intakeUpdatedAt: updatedAt.toISOString(),
  })
}

const importProposalCommand: CommandHandler<ScopingProposalImportCommandInput, ScopingProposalImportCommandResult> = {
  id: 'delivery_os.intake.import_proposal',
  async execute(rawInput, ctx) {
    const trustedOption = readTrustedExecutionOption(rawInput)
    if (trustedOption !== undefined && (ctx.request || !isIssuedTrustedExecution(trustedOption))) throw trustedExecutionRequired()
    const scope = resolveDeliveryScope(ctx)
    const parsed = parseDeliveryInput(scopingProposalImportCommandSchema, rawInput)
    const actor = resolveIntakeActor(ctx, parsed.trustedExecution?.actorUserId)

    const probeEm = resolveDeliveryEm(ctx)
    const project = await requireScopedProject(probeEm, parsed.projectId, scope)
    const probeRow = await findScopedIntake(probeEm, project.id, scope)
    const probe = mergeScopingProposal({
      stored: probeRow ? toIntakeDocument(probeRow) : null,
      importedManifests: probeRow?.importedManifests ?? [],
      proposal: parsed.proposal,
      project: projectContext(project),
      now: new Date().toISOString(),
    })
    if (!probe.ok) throw deliveryFlowHttpError(probe)
    if (probe.duplicate) {
      return toImportResult(project, parsed.proposal.manifestId, probe.manifestHash, true, intakeVersion(probeRow, project))
    }
    if (ctx.request) requireLockHeader(ctx)

    const em = resolveDeliveryEm(ctx)
    const outcome = await em.transactional(async (tx) => {
      const locked = await lockScopedProject(tx, parsed.projectId, scope)
      const intakeRow = await findScopedIntake(tx, locked.id, scope, { lock: true })
      const now = new Date()
      const merged = mergeScopingProposal({
        stored: intakeRow ? toIntakeDocument(intakeRow) : null,
        importedManifests: intakeRow?.importedManifests ?? [],
        proposal: parsed.proposal,
        project: projectContext(locked),
        now: now.toISOString(),
      })
      if (!merged.ok) throw deliveryFlowHttpError(merged)
      if (merged.duplicate) return { project: locked, manifestHash: merged.manifestHash, duplicate: true, written: intakeRow }
      await enforceIntakeLock(ctx, intakeRow, locked)
      const written = writeIntake(
        tx,
        scope,
        locked,
        intakeRow,
        { intake: merged.intake, importedManifests: merged.importedManifests },
        actor,
        now,
      )
      return { project: locked, manifestHash: merged.manifestHash, duplicate: false, written }
    })
    return toImportResult(
      outcome.project,
      parsed.proposal.manifestId,
      outcome.manifestHash,
      outcome.duplicate,
      intakeVersion(outcome.written, outcome.project),
    )
  },
  buildLog: async ({ input, result, ctx }) => {
    if (result.duplicate) return null
    const scope = resolveDeliveryScope(ctx)
    const parsed = scopingProposalImportCommandSchema.safeParse(input)
    const trustedActorId = parsed.success ? parsed.data.trustedExecution?.actorUserId : undefined
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('delivery_os.audit.intake.import_proposal', 'Import scoping proposal'),
      resourceKind: DELIVERY_INTAKE_RESOURCE_KIND,
      resourceId: result.projectId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      ...(trustedActorId ? { actorUserId: trustedActorId } : {}),
      snapshotAfter: result,
    }
  },
}

registerCommand(updateIntakeCommand)
registerCommand(importProposalCommand)
