import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { DeliveryProject } from '../data/entities'
import {
  flowInstanceLinkCommandSchema,
  flowPinCommandSchema,
  type FlowInstanceLinkCommandInput,
  type FlowPinCommandInput,
} from '../data/validators'
import {
  buildDeliveryError,
  buildDeliveryFlowError,
  flowPinResponseSchema,
  type FlowPinResponse,
  type FlowTemplateV1,
} from '../lib/contracts'
import { hashFlowTemplate } from '../lib/flowRules'
import { isIssuedTrustedExecution, readTrustedExecutionOption } from '../lib/trustedExecution'
import { emitDeliveryOsEvent } from '../events'
import { parseFlowTemplateLookup, resolveFlowTemplateProvider } from './flowTemplateProvider'
import {
  DELIVERY_PROJECT_RESOURCE_KIND,
  deliveryFlowHttpError,
  deliveryHttpError,
  lockScopedProject,
  parseDeliveryInput,
  requireLockHeader,
  requireScopedProject,
  resolveDeliveryEm,
  resolveDeliveryScope,
  type DeliveryScope,
} from './shared'

export type FlowPinCommandResult = FlowPinResponse & { duplicate: boolean }

export type FlowInstanceLinkCommandResult = {
  projectId: string
  workflowInstanceId: string
  changed: boolean
  projectUpdatedAt: string
}

type PinnedTemplate = { templateId: string; version: number; hash: string; pinnedAt: Date }

type ResolvedTemplate = { template: FlowTemplateV1; hash: string }

function readPinned(project: DeliveryProject): PinnedTemplate | null {
  if (!project.flowTemplateId || !project.flowTemplateVersion || !project.flowTemplateHash || !project.flowPinnedAt) return null
  return {
    templateId: project.flowTemplateId,
    version: project.flowTemplateVersion,
    hash: project.flowTemplateHash,
    pinnedAt: project.flowPinnedAt,
  }
}

function alreadyPinnedError(pinned: PinnedTemplate, detailCode: string, message: string) {
  return deliveryFlowHttpError(
    buildDeliveryFlowError('flow_already_pinned', 'The project is already pinned', [
      { path: 'templateId', code: detailCode, message: `${message}: ${pinned.templateId}@${pinned.version}` },
    ]),
  )
}

function checkPinState(project: DeliveryProject, request: FlowPinCommandInput): PinnedTemplate | null {
  const pinned = readPinned(project)
  if (!pinned) return null
  if (pinned.templateId === request.templateId && pinned.version === request.templateVersion) return pinned
  throw alreadyPinnedError(pinned, 'flow_already_pinned', 'Pinned to another template')
}

function toPinResult(project: DeliveryProject, pinned: PinnedTemplate, duplicate: boolean): FlowPinCommandResult {
  const response = flowPinResponseSchema.parse({
    projectId: project.id,
    template: { templateId: pinned.templateId, version: pinned.version, hash: pinned.hash },
    pinnedAt: pinned.pinnedAt.toISOString(),
    projectUpdatedAt: project.updatedAt.toISOString(),
  })
  return { ...response, duplicate }
}

async function resolveTemplate(ctx: CommandRuntimeContext, request: FlowPinCommandInput): Promise<ResolvedTemplate> {
  const unknown = () =>
    deliveryFlowHttpError(
      buildDeliveryFlowError('unknown_flow_template', 'Unknown flow template', [
        { path: 'templateId', code: 'unknown_flow_template', message: `${request.templateId}@${request.templateVersion}` },
      ]),
    )
  const provider = resolveFlowTemplateProvider(ctx.container)
  if (!provider) throw unknown()
  const lookup = parseFlowTemplateLookup(await provider.getTemplate(request.templateId, request.templateVersion))
  if (!lookup || lookup.template.templateId !== request.templateId || lookup.template.version !== request.templateVersion) {
    throw unknown()
  }
  const hash = hashFlowTemplate(lookup.template)
  if (lookup.statedHash !== null && lookup.statedHash !== hash) {
    throw deliveryFlowHttpError(
      buildDeliveryFlowError('flow_template_hash_mismatch', 'The provider hash does not match the template content', [
        { path: 'templateVersion', code: 'flow_template_hash_mismatch', message: `stated ${lookup.statedHash}, computed ${hash}` },
      ]),
    )
  }
  return { template: lookup.template, hash }
}

async function emitFlowPinned(scope: DeliveryScope, project: DeliveryProject, pinned: PinnedTemplate): Promise<void> {
  await emitDeliveryOsEvent(
    'delivery_os.flow.pinned',
    {
      projectId: project.id,
      templateId: pinned.templateId,
      templateVersion: pinned.version,
      templateHash: pinned.hash,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
}

const pinFlowCommand: CommandHandler<FlowPinCommandInput, FlowPinCommandResult> = {
  id: 'delivery_os.flow.pin',
  async execute(rawInput, ctx) {
    const scope = resolveDeliveryScope(ctx)
    const parsed = parseDeliveryInput(flowPinCommandSchema, rawInput)

    const probe = await requireScopedProject(resolveDeliveryEm(ctx), parsed.projectId, scope)
    const alreadyPinned = checkPinState(probe, parsed)
    if (alreadyPinned) return toPinResult(probe, alreadyPinned, true)

    const resolved = await resolveTemplate(ctx, parsed)
    requireLockHeader(ctx)

    const em = resolveDeliveryEm(ctx)
    const outcome = await em.transactional(async (tx) => {
      const project = await lockScopedProject(tx, parsed.projectId, scope)
      const pinned = checkPinState(project, parsed)
      if (pinned) return { project, pinned, duplicate: true }
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
        resourceId: project.id,
        current: project.updatedAt,
        request: ctx.request ?? null,
      })
      const now = new Date()
      project.flowTemplateId = resolved.template.templateId
      project.flowTemplateVersion = resolved.template.version
      project.flowTemplateHash = resolved.hash
      project.flowTemplateSnapshot = resolved.template
      project.flowPinnedAt = now
      project.updatedAt = now
      return {
        project,
        pinned: { templateId: resolved.template.templateId, version: resolved.template.version, hash: resolved.hash, pinnedAt: now },
        duplicate: false,
      }
    })

    if (!outcome.duplicate) await emitFlowPinned(scope, outcome.project, outcome.pinned)
    return toPinResult(outcome.project, outcome.pinned, outcome.duplicate)
  },
  buildLog: async ({ result, ctx }) => {
    if (result.duplicate) return null
    const scope = resolveDeliveryScope(ctx)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('delivery_os.audit.flow.pin', 'Pin delivery process template'),
      resourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      resourceId: result.projectId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      snapshotAfter: result,
    }
  },
}

function trustedExecutionRequired(): ReturnType<typeof deliveryHttpError> {
  return deliveryHttpError(
    buildDeliveryError('forbidden', 'This command is reserved for the trusted in-process project workflow', [
      { path: 'trustedExecution', code: 'trusted_execution_required' },
    ]),
  )
}

const linkInstanceCommand: CommandHandler<FlowInstanceLinkCommandInput, FlowInstanceLinkCommandResult> = {
  id: 'delivery_os.flow.link_instance',
  async execute(rawInput, ctx) {
    if (ctx.request || !isIssuedTrustedExecution(readTrustedExecutionOption(rawInput))) throw trustedExecutionRequired()
    const scope = resolveDeliveryScope(ctx)
    const parsed = parseDeliveryInput(flowInstanceLinkCommandSchema, rawInput)

    const em = resolveDeliveryEm(ctx)
    const outcome = await em.transactional(async (tx) => {
      const project = await lockScopedProject(tx, parsed.projectId, scope)
      if (!readPinned(project)) {
        throw deliveryFlowHttpError(
          buildDeliveryFlowError('flow_not_pinned', 'Pin a process template before linking a workflow instance', [
            { path: 'projectId', code: 'flow_not_pinned' },
          ]),
        )
      }
      if (project.flowWorkflowInstanceId) {
        if (project.flowWorkflowInstanceId === parsed.workflowInstanceId) return { project, changed: false }
        throw deliveryFlowHttpError(
          buildDeliveryFlowError('flow_already_pinned', 'The project is already linked to another workflow instance', [
            { path: 'workflowInstanceId', code: 'instance_already_linked', message: project.flowWorkflowInstanceId },
          ]),
        )
      }
      project.flowWorkflowInstanceId = parsed.workflowInstanceId
      project.flowWorkflowDefinitionId = parsed.definitionId
      project.updatedAt = new Date()
      return { project, changed: true }
    })

    return {
      projectId: outcome.project.id,
      workflowInstanceId: parsed.workflowInstanceId,
      changed: outcome.changed,
      projectUpdatedAt: outcome.project.updatedAt.toISOString(),
    }
  },
  buildLog: async ({ input, result, ctx }) => {
    if (!result.changed) return null
    const scope = resolveDeliveryScope(ctx)
    const parsed = flowInstanceLinkCommandSchema.safeParse(input)
    const trustedActorId = parsed.success ? parsed.data.trustedExecution.actorUserId : undefined
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('delivery_os.audit.flow.link_instance', 'Link delivery project to a workflow instance'),
      resourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      resourceId: result.projectId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      ...(trustedActorId ? { actorUserId: trustedActorId } : {}),
      snapshotAfter: result,
    }
  },
}

registerCommand(pinFlowCommand)
registerCommand(linkInstanceCommand)
