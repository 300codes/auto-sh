import { z } from 'zod'
import {
  baselineContentV1Schema,
  deliveryErrorBodySchema,
  deliveryErrorCodeSchema,
  designManifestV1Schema,
  executionWidgetContextV1Schema,
  planProposalV1Schema,
  requirementsProposalV1Schema,
  reserveAttemptResponseSchema,
  resultManifestV1Schema,
  taskPackageV1Schema,
  type BaselineContentV1,
  type DeliveryErrorBody,
  type DesignManifestV1,
  type ExecutionWidgetContextV1,
  type PlanProposalV1,
  type RequirementsProposalV1,
  type ReserveAttemptResponse,
  type ResultManifestV1,
  type TaskPackageV1,
} from '../contracts'
import taskPackageJson from './task-package.v1.json'
import taskPackageSnapshotJson from './task-package.snapshot.v1.json'
import resultManifestJson from './result-manifest.v1.json'
import resultManifestSnapshotJson from './result-manifest.snapshot.v1.json'
import baselineContentJson from './baseline-content.v1.json'
import requirementsProposalJson from './requirements-proposal.v1.json'
import planProposalJson from './plan-proposal.v1.json'
import designManifestJson from './design-manifest.v1.json'
import executionWidgetContextJson from './execution-widget-context.v1.json'
import reserveResponseJson from './reserve-response.v1.json'
import errorBodyJson from './error-body.v1.json'
import taskPackageUnknownSchemaVersionJson from './negative/task-package.unknown-schema-version.v1.json'
import resultManifestForeignTaskJson from './negative/result-manifest.foreign-task.v1.json'
import resultManifestForeignAttemptJson from './negative/result-manifest.foreign-attempt.v1.json'
import resultManifestSnapshotForReactJson from './negative/result-manifest.snapshot-for-react.v1.json'
import resultManifestMissingCheckFieldsJson from './negative/result-manifest.missing-check-fields.v1.json'
import resultManifestStatusSkippedJson from './negative/result-manifest.status-skipped.v1.json'
import reserveDuplicateKeyJson from './negative/reserve.duplicate-key.v1.json'
import reserveAutomaticModeJson from './negative/reserve.automatic-mode.v1.json'
import planProposalCycleJson from './negative/plan-proposal.cycle.v1.json'
import planProposalSelfCycleJson from './negative/plan-proposal.self-cycle.v1.json'
import planProposalPathTraversalJson from './negative/plan-proposal.path-traversal.v1.json'
import planProposalAbsolutePathJson from './negative/plan-proposal.absolute-path.v1.json'
import planProposalOutsideProfileRootsJson from './negative/plan-proposal.outside-profile-roots.v1.json'

export { buildResultManifest, deriveFakeResultRevision, type ResultManifestOverrides } from './builders'

export const positiveDeliveryFixtures = [
  { name: 'task-package', schema: taskPackageV1Schema, document: taskPackageJson },
  { name: 'task-package.snapshot', schema: taskPackageV1Schema, document: taskPackageSnapshotJson },
  { name: 'result-manifest', schema: resultManifestV1Schema, document: resultManifestJson },
  { name: 'result-manifest.snapshot', schema: resultManifestV1Schema, document: resultManifestSnapshotJson },
  { name: 'baseline-content', schema: baselineContentV1Schema, document: baselineContentJson },
  { name: 'requirements-proposal', schema: requirementsProposalV1Schema, document: requirementsProposalJson },
  { name: 'plan-proposal', schema: planProposalV1Schema, document: planProposalJson },
  { name: 'design-manifest', schema: designManifestV1Schema, document: designManifestJson },
  { name: 'execution-widget-context', schema: executionWidgetContextV1Schema, document: executionWidgetContextJson },
  { name: 'reserve-response', schema: reserveAttemptResponseSchema, document: reserveResponseJson },
  { name: 'error-body', schema: deliveryErrorBodySchema, document: errorBodyJson },
] as const

export type PositiveDeliveryFixtureName = (typeof positiveDeliveryFixtures)[number]['name']

function parseFixture<TSchema extends z.ZodType>(schema: TSchema, document: unknown, name: string): z.output<TSchema> {
  const parsed = schema.safeParse(document)
  if (!parsed.success) throw new Error(`[internal] delivery fixture ${name} does not match its published schema`)
  return parsed.data
}

export type FixtureVariant = 'git' | 'snapshot'

export function loadTaskPackageFixture(variant: FixtureVariant = 'git'): TaskPackageV1 {
  const document = variant === 'git' ? taskPackageJson : taskPackageSnapshotJson
  return parseFixture(taskPackageV1Schema, document, `task-package (${variant})`)
}

export function loadResultManifestFixture(variant: FixtureVariant = 'git'): ResultManifestV1 {
  const document = variant === 'git' ? resultManifestJson : resultManifestSnapshotJson
  return parseFixture(resultManifestV1Schema, document, `result-manifest (${variant})`)
}

export function loadBaselineContentFixture(): BaselineContentV1 {
  return parseFixture(baselineContentV1Schema, baselineContentJson, 'baseline-content')
}

export function loadRequirementsProposalFixture(): RequirementsProposalV1 {
  return parseFixture(requirementsProposalV1Schema, requirementsProposalJson, 'requirements-proposal')
}

export function loadPlanProposalFixture(): PlanProposalV1 {
  return parseFixture(planProposalV1Schema, planProposalJson, 'plan-proposal')
}

export function loadDesignManifestFixture(): DesignManifestV1 {
  return parseFixture(designManifestV1Schema, designManifestJson, 'design-manifest')
}

export function loadReserveResponseFixture(): ReserveAttemptResponse {
  return parseFixture(reserveAttemptResponseSchema, reserveResponseJson, 'reserve-response')
}

export function loadErrorBodyFixture(): DeliveryErrorBody {
  return parseFixture(deliveryErrorBodySchema, errorBodyJson, 'error-body')
}

export function buildExecutionWidgetContextFixture(
  overrides: Partial<ExecutionWidgetContextV1> = {},
): ExecutionWidgetContextV1 {
  return parseFixture(
    executionWidgetContextV1Schema,
    { ...executionWidgetContextJson, retryLastMutation: async () => true, refresh: () => undefined, ...overrides },
    'execution-widget-context',
  )
}

export const negativeFixtureStages = ['schema', 'profile', 'correlation', 'dag', 'idempotency'] as const
export type NegativeFixtureStage = (typeof negativeFixtureStages)[number]

export const negativeDeliveryFixtureSchema = z.object({
  description: z.string().min(1),
  expected: z.object({
    stage: z.enum(negativeFixtureStages),
    code: deliveryErrorCodeSchema,
    status: z.number().int(),
  }),
  documentType: z.enum(['versioned', 'reserve-request', 'reserve-pair']),
  correlatesWith: z.enum(['task-package', 'task-package.snapshot']).optional(),
  targetProfile: z.object({ id: z.string().min(1), version: z.number().int().positive() }).optional(),
  document: z.unknown(),
})
export type NegativeDeliveryFixture = z.infer<typeof negativeDeliveryFixtureSchema> & { name: string }

const negativeFixtureDocuments = {
  'task-package.unknown-schema-version': taskPackageUnknownSchemaVersionJson,
  'result-manifest.foreign-task': resultManifestForeignTaskJson,
  'result-manifest.foreign-attempt': resultManifestForeignAttemptJson,
  'result-manifest.snapshot-for-react': resultManifestSnapshotForReactJson,
  'result-manifest.missing-check-fields': resultManifestMissingCheckFieldsJson,
  'result-manifest.status-skipped': resultManifestStatusSkippedJson,
  'reserve.duplicate-key': reserveDuplicateKeyJson,
  'reserve.automatic-mode': reserveAutomaticModeJson,
  'plan-proposal.cycle': planProposalCycleJson,
  'plan-proposal.self-cycle': planProposalSelfCycleJson,
  'plan-proposal.path-traversal': planProposalPathTraversalJson,
  'plan-proposal.absolute-path': planProposalAbsolutePathJson,
  'plan-proposal.outside-profile-roots': planProposalOutsideProfileRootsJson,
} as const

export type NegativeDeliveryFixtureName = keyof typeof negativeFixtureDocuments

export function loadNegativeDeliveryFixtures(): NegativeDeliveryFixture[] {
  return Object.entries(negativeFixtureDocuments).map(([name, wrapper]) => ({
    name,
    ...parseFixture(negativeDeliveryFixtureSchema, wrapper, `negative/${name}`),
  }))
}
