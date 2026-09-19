import { deliveryErrorFromZod } from '../../lib/contracts'
import {
  loadIntakeFixture,
  loadScopingProposalFixture,
  loadStageArtifactFixture,
  loadStageDecisionRequestFixture,
} from '../../lib/fixtures/flow/index'
import {
  flowInstanceLinkCommandSchema,
  flowPinCommandSchema,
  intakeUpdateCommandSchema,
  scopingProposalImportCommandSchema,
  stageArtifactCreateCommandSchema,
  stageDecisionCommandSchema,
  stageHistoryListQuerySchema,
} from '../validators'

const OTHER_PROJECT_ID = '99999999-9999-4999-8999-999999999999'
const ACTOR_ID = '77777777-7777-4777-8777-777777777777'

function intakeBody() {
  const { projectId: _projectId, proposals: _proposals, ...rest } = loadIntakeFixture()
  return rest
}

function firstDeliveryCode(result: { success: false; error: Parameters<typeof deliveryErrorFromZod>[0] }): string {
  return deliveryErrorFromZod(result.error).body.code
}

describe('flow F1 command validators', () => {
  it('accepts an intake update and strips a forged proposals key', () => {
    const projectId = loadIntakeFixture().projectId
    const forged = { ...intakeBody(), proposals: [{ proposalId: 'forged' }] }
    const parsed = intakeUpdateCommandSchema.safeParse({ projectId, intake: forged })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.intake).not.toHaveProperty('proposals')
  })

  it('rejects an intake update with an unknown step', () => {
    const projectId = loadIntakeFixture().projectId
    const parsed = intakeUpdateCommandSchema.safeParse({ projectId, intake: { ...intakeBody(), step: 'done' } })
    expect(parsed.success).toBe(false)
  })

  it('binds a scoping proposal to the path project', () => {
    const proposal = loadScopingProposalFixture()
    expect(scopingProposalImportCommandSchema.safeParse({ projectId: proposal.projectId, proposal }).success).toBe(true)
    const foreign = scopingProposalImportCommandSchema.safeParse({ projectId: OTHER_PROJECT_ID, proposal })
    expect(foreign.success).toBe(false)
    if (!foreign.success) expect(firstDeliveryCode(foreign)).toBe('foreign_reference')
  })

  it('requires project id and template ref for a pin', () => {
    const projectId = loadIntakeFixture().projectId
    expect(flowPinCommandSchema.safeParse({ projectId, templateId: 'delivery-default', templateVersion: 1 }).success).toBe(true)
    expect(flowPinCommandSchema.safeParse({ projectId, templateId: 'delivery-default', templateVersion: 0 }).success).toBe(false)
  })

  it('requires trusted execution to link a workflow instance', () => {
    const link = {
      projectId: loadIntakeFixture().projectId,
      workflowInstanceId: OTHER_PROJECT_ID,
      definitionId: ACTOR_ID,
      workflowId: 'delivery_project_flow',
      version: 1,
    }
    expect(flowInstanceLinkCommandSchema.safeParse(link).success).toBe(false)
    const trusted = { ...link, trustedExecution: { source: 'delivery_agents', actorUserId: ACTOR_ID } }
    expect(flowInstanceLinkCommandSchema.safeParse(trusted).success).toBe(true)
  })

  it('accepts a stage artifact whose stage and project match the path', () => {
    const artifact = loadStageArtifactFixture('scope')
    const parsed = stageArtifactCreateCommandSchema.safeParse({ projectId: artifact.projectId, stageId: 'scope', artifact })
    expect(parsed.success).toBe(true)
  })

  it('rejects a stage artifact posted under another stage or project', () => {
    const artifact = loadStageArtifactFixture('scope')
    const wrongStage = stageArtifactCreateCommandSchema.safeParse({ projectId: artifact.projectId, stageId: 'ux', artifact })
    expect(wrongStage.success).toBe(false)
    if (!wrongStage.success) expect(firstDeliveryCode(wrongStage)).toBe('foreign_reference')
    const wrongProject = stageArtifactCreateCommandSchema.safeParse({ projectId: OTHER_PROJECT_ID, stageId: 'scope', artifact })
    expect(wrongProject.success).toBe(false)
  })

  it('rejects an unknown path stage id', () => {
    const artifact = loadStageArtifactFixture('scope')
    const parsed = stageArtifactCreateCommandSchema.safeParse({ projectId: artifact.projectId, stageId: 'deploy', artifact })
    expect(parsed.success).toBe(false)
  })

  it('requires an idempotency key for a stage decision', () => {
    const decision = loadStageDecisionRequestFixture()
    const projectId = loadIntakeFixture().projectId
    expect(stageDecisionCommandSchema.safeParse({ projectId, stageId: 'scope', decision }).success).toBe(false)
    expect(
      stageDecisionCommandSchema.safeParse({ projectId, stageId: 'scope', idempotencyKey: 'decide-scope-1', decision }).success,
    ).toBe(true)
  })

  it('requires a reason for a rejected stage decision', () => {
    const decision = { ...loadStageDecisionRequestFixture(), verdict: 'rejected' as const, reason: null }
    const parsed = stageDecisionCommandSchema.safeParse({
      projectId: loadIntakeFixture().projectId,
      stageId: 'scope',
      idempotencyKey: 'decide-scope-2',
      decision,
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(firstDeliveryCode(parsed)).toBe('reason_required')
  })
})

describe('stageHistoryListQuerySchema', () => {
  it('defaults paging', () => {
    expect(stageHistoryListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 50 })
  })

  it('coerces query strings and caps pageSize at 100', () => {
    expect(stageHistoryListQuerySchema.parse({ page: '2', pageSize: '100' })).toEqual({ page: 2, pageSize: 100 })
    expect(stageHistoryListQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false)
    expect(stageHistoryListQuerySchema.safeParse({ page: '0' }).success).toBe(false)
  })
})
