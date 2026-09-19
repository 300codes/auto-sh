import { z } from 'zod'
import {
  commentImportBatchV1Schema,
  commentImportResultSchema,
  commentThreadTriageRequestSchema,
  deliveryFlowErrorBodySchema,
  flowStatusV1Schema,
  flowTemplateV1Schema,
  intakeV1Schema,
  publicationResultV1Schema,
  scopingProposalV1Schema,
  staffLinkSchema,
  stageArtifactV1Schema,
  stageDecisionRequestSchema,
  type CommentImportBatchV1,
  type CommentImportResult,
  type FlowStatusV1,
  type FlowTemplateV1,
  type IntakeV1,
  type PublicationResultV1,
  type ScopingProposalV1,
  type StaffLink,
  type StageArtifactV1,
  type StageDecisionRequest,
} from '../../contracts'
import intakeJson from './intake.v1.json' with { type: 'json' }
import scopingProposalJson from './scoping-proposal.v1.json' with { type: 'json' }
import flowTemplateJson from './flow-template.v1.json' with { type: 'json' }
import stageArtifactScopeJson from './stage-artifact.scope.v1.json' with { type: 'json' }
import stageArtifactUxJson from './stage-artifact.ux.v1.json' with { type: 'json' }
import stageDecisionRequestJson from './stage-decision.request.v1.json' with { type: 'json' }
import flowStatusJson from './flow-status.v1.json' with { type: 'json' }
import commentImportJson from './comment-import.v1.json' with { type: 'json' }
import commentImportResultJson from './comment-import.result.v1.json' with { type: 'json' }
import staffLinkJson from './staff-link.v1.json' with { type: 'json' }
import publicationResultJson from './publication-result.v1.json' with { type: 'json' }
import intakeInvalidStepJson from './negative/intake.invalid-step.v1.json' with { type: 'json' }
import intakeUnknownSchemaVersionJson from './negative/intake.unknown-schema-version.v1.json' with { type: 'json' }
import scopingProposalScopeWithoutContentJson from './negative/scoping-proposal.scope-without-content.v1.json' with { type: 'json' }
import stageArtifactUnknownStageJson from './negative/stage-artifact.unknown-stage.v1.json' with { type: 'json' }
import stageArtifactDependencyNotUpstreamJson from './negative/stage-artifact.dependency-not-upstream.v1.json' with { type: 'json' }
import stageArtifactDuplicateDependencyJson from './negative/stage-artifact.duplicate-dependency.v1.json' with { type: 'json' }
import stageDecisionRejectedWithoutReasonJson from './negative/stage-decision.rejected-without-reason.v1.json' with { type: 'json' }
import stageDecisionClientApprovalWithoutNameJson from './negative/stage-decision.client-approval-without-name.v1.json' with { type: 'json' }
import commentImportDuplicateThreadKeyJson from './negative/comment-import.duplicate-thread-key.v1.json' with { type: 'json' }
import commentImportMissingThreadKeyJson from './negative/comment-import.missing-thread-key.v1.json' with { type: 'json' }
import commentImportDuplicateCommentKeyJson from './negative/comment-import.duplicate-comment-key.v1.json' with { type: 'json' }
import flowTemplateDuplicateStageJson from './negative/flow-template.duplicate-stage.v1.json' with { type: 'json' }
import flowTemplateDependencyCycleJson from './negative/flow-template.dependency-cycle.v1.json' with { type: 'json' }
import publicationResultVerifiedWithoutEvidenceJson from './negative/publication-result.verified-without-evidence.v1.json' with { type: 'json' }
import triageDeferredWithoutDeferralJson from './negative/triage.deferred-without-deferral.v1.json' with { type: 'json' }

export const positiveFlowFixtures = [
  { name: 'intake', schema: intakeV1Schema, document: intakeJson, versioned: true },
  { name: 'scoping-proposal', schema: scopingProposalV1Schema, document: scopingProposalJson, versioned: true },
  { name: 'flow-template', schema: flowTemplateV1Schema, document: flowTemplateJson, versioned: true },
  { name: 'stage-artifact.scope', schema: stageArtifactV1Schema, document: stageArtifactScopeJson, versioned: true },
  { name: 'stage-artifact.ux', schema: stageArtifactV1Schema, document: stageArtifactUxJson, versioned: true },
  { name: 'stage-decision.request', schema: stageDecisionRequestSchema, document: stageDecisionRequestJson, versioned: false },
  { name: 'flow-status', schema: flowStatusV1Schema, document: flowStatusJson, versioned: true },
  { name: 'comment-import', schema: commentImportBatchV1Schema, document: commentImportJson, versioned: true },
  { name: 'comment-import.result', schema: commentImportResultSchema, document: commentImportResultJson, versioned: false },
  { name: 'staff-link', schema: staffLinkSchema, document: staffLinkJson, versioned: false },
  { name: 'publication-result', schema: publicationResultV1Schema, document: publicationResultJson, versioned: true },
] as const

export type PositiveFlowFixtureName = (typeof positiveFlowFixtures)[number]['name']

function parseFixture<TSchema extends z.ZodType>(schema: TSchema, document: unknown, name: string): z.output<TSchema> {
  const parsed = schema.safeParse(document)
  if (!parsed.success) throw new Error(`[internal] delivery flow fixture ${name} does not match its published schema`)
  return parsed.data
}

export function loadIntakeFixture(): IntakeV1 {
  return parseFixture(intakeV1Schema, intakeJson, 'intake')
}

export function loadScopingProposalFixture(): ScopingProposalV1 {
  return parseFixture(scopingProposalV1Schema, scopingProposalJson, 'scoping-proposal')
}

export function loadFlowTemplateFixture(): FlowTemplateV1 {
  return parseFixture(flowTemplateV1Schema, flowTemplateJson, 'flow-template')
}

export function loadStageArtifactFixture(stage: 'scope' | 'ux'): StageArtifactV1 {
  const document = stage === 'scope' ? stageArtifactScopeJson : stageArtifactUxJson
  return parseFixture(stageArtifactV1Schema, document, `stage-artifact.${stage}`)
}

export function loadStageDecisionRequestFixture(): StageDecisionRequest {
  return parseFixture(stageDecisionRequestSchema, stageDecisionRequestJson, 'stage-decision.request')
}

export function loadFlowStatusFixture(): FlowStatusV1 {
  return parseFixture(flowStatusV1Schema, flowStatusJson, 'flow-status')
}

export function loadCommentImportFixture(): CommentImportBatchV1 {
  return parseFixture(commentImportBatchV1Schema, commentImportJson, 'comment-import')
}

export function loadCommentImportResultFixture(): CommentImportResult {
  return parseFixture(commentImportResultSchema, commentImportResultJson, 'comment-import.result')
}

export function loadStaffLinkFixture(): StaffLink {
  return parseFixture(staffLinkSchema, staffLinkJson, 'staff-link')
}

export function loadPublicationResultFixture(): PublicationResultV1 {
  return parseFixture(publicationResultV1Schema, publicationResultJson, 'publication-result')
}

export const negativeFlowFixtureSchema = z.object({
  description: z.string().min(1),
  expected: z.object({
    stage: z.literal('schema'),
    code: deliveryFlowErrorBodySchema.shape.code,
    status: z.number().int(),
  }),
  documentType: z.enum(['versioned', 'stage-decision', 'triage']),
  document: z.unknown(),
})
export type NegativeFlowFixture = z.infer<typeof negativeFlowFixtureSchema> & { name: string }

const negativeFlowFixtureDocuments = {
  'intake.invalid-step': intakeInvalidStepJson,
  'intake.unknown-schema-version': intakeUnknownSchemaVersionJson,
  'scoping-proposal.scope-without-content': scopingProposalScopeWithoutContentJson,
  'stage-artifact.unknown-stage': stageArtifactUnknownStageJson,
  'stage-artifact.dependency-not-upstream': stageArtifactDependencyNotUpstreamJson,
  'stage-artifact.duplicate-dependency': stageArtifactDuplicateDependencyJson,
  'stage-decision.rejected-without-reason': stageDecisionRejectedWithoutReasonJson,
  'stage-decision.client-approval-without-name': stageDecisionClientApprovalWithoutNameJson,
  'comment-import.duplicate-thread-key': commentImportDuplicateThreadKeyJson,
  'comment-import.missing-thread-key': commentImportMissingThreadKeyJson,
  'comment-import.duplicate-comment-key': commentImportDuplicateCommentKeyJson,
  'flow-template.duplicate-stage': flowTemplateDuplicateStageJson,
  'flow-template.dependency-cycle': flowTemplateDependencyCycleJson,
  'publication-result.verified-without-evidence': publicationResultVerifiedWithoutEvidenceJson,
  'triage.deferred-without-deferral': triageDeferredWithoutDeferralJson,
} as const

export type NegativeFlowFixtureName = keyof typeof negativeFlowFixtureDocuments

export function loadNegativeFlowFixtures(): NegativeFlowFixture[] {
  return Object.entries(negativeFlowFixtureDocuments).map(([name, wrapper]) => ({
    name,
    ...parseFixture(negativeFlowFixtureSchema, wrapper, `negative/${name}`),
  }))
}

export const flowSchemaByDocumentType = {
  'stage-decision': stageDecisionRequestSchema,
  triage: commentThreadTriageRequestSchema,
} as const
