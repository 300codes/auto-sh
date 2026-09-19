import { DELIVERY_SCHEMA_VERSIONS } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import type { BaselineDto } from '@open-mercato/core/modules/delivery_os/api/schemas'
import {
  decisionStateFor,
  defaultSelectedBaselineId,
  overallDecisionState,
  reconcileSelectedBaselineId,
  resolveActiveBaseline,
  resolveBaseline,
} from '../baselineContent'

const projectId = '11111111-1111-4111-8111-111111111111'
const actorId = '99999999-9999-4999-8999-999999999999'
const now = '2026-09-19T10:00:00.000Z'

function hashFor(version: number): string {
  return String(version).repeat(64).slice(0, 64)
}

const content = {
  schemaVersion: DELIVERY_SCHEMA_VERSIONS.baselineContent,
  requirements: [{ id: 'REQ-1', title: 'A requirement' }],
  acceptanceCriteria: [{ id: 'AC-1', requirementId: 'REQ-1', description: 'Something observable.' }],
  screens: [],
  tokens: {},
  architectureSummary: null,
  planSummary: null,
  acTestMap: {},
  manualChecks: {},
  declaredTests: [],
  attachments: [],
  resolvedComments: [],
  importedManifestHashes: [],
}

function decision(kind: string, verdict: 'approved' | 'rejected', id: string, version: number) {
  return {
    id,
    kind,
    verdict,
    subjectHash: hashFor(version),
    subjectVersion: version,
    reason: verdict === 'rejected' ? 'Not yet' : null,
    actorUserId: actorId,
    decidedAt: now,
  }
}

function baseline(version: number, overrides: Partial<BaselineDto> = {}): BaselineDto {
  return {
    id: `${version}${'0'.repeat(7)}-0000-4000-8000-000000000000`.slice(0, 36),
    projectId,
    version,
    contentHash: hashFor(version),
    source: 'manual',
    parentBaselineId: null,
    content,
    attachmentIds: [],
    createdBy: null,
    createdAt: now,
    isActive: false,
    decisions: [],
    ...overrides,
  }
}

describe('resolveBaseline', () => {
  const v1 = baseline(1)
  const v2 = baseline(2, { isActive: true })
  const v3 = baseline(3)

  it('falls back to the active version when nothing is selected', () => {
    const resolved = resolveBaseline([v3, v2, v1], null)
    expect(resolved.kind).toBe('ready')
    if (resolved.kind !== 'ready') return
    expect(resolved.baseline.version).toBe(2)
  })

  it('shows the selected version even though it is not the active one — that is what a decision is about', () => {
    const resolved = resolveBaseline([v3, v2, v1], v3.id)
    expect(resolved.kind).toBe('ready')
    if (resolved.kind !== 'ready') return
    expect(resolved.baseline.version).toBe(3)
  })

  it('keeps the three outcomes of resolveActiveBaseline unchanged', () => {
    expect(resolveActiveBaseline([]).kind).toBe('none')
    expect(resolveActiveBaseline([baseline(1, { isActive: true, content: { schemaVersion: DELIVERY_SCHEMA_VERSIONS.baselineContent } })]).kind)
      .toBe('unreadable')
    expect(resolveActiveBaseline([v2]).kind).toBe('ready')
  })
})

describe('defaultSelectedBaselineId', () => {
  it('prefers the active version', () => {
    expect(defaultSelectedBaselineId([baseline(1), baseline(2, { isActive: true }), baseline(3)]))
      .toBe(baseline(2).id)
  })

  it('falls back to the newest version when nothing is active yet', () => {
    expect(defaultSelectedBaselineId([baseline(1), baseline(3), baseline(2)])).toBe(baseline(3).id)
  })

  it('returns null with no baselines at all', () => {
    expect(defaultSelectedBaselineId([])).toBeNull()
  })
})

describe('reconcileSelectedBaselineId', () => {
  it('keeps a selection the list still carries', () => {
    const list = [baseline(1), baseline(2, { isActive: true })]
    expect(reconcileSelectedBaselineId(list, baseline(1).id)).toBe(baseline(1).id)
  })

  it('clears a selection the refetched list no longer carries instead of rendering a dead id', () => {
    const list = [baseline(2, { isActive: true })]
    expect(reconcileSelectedBaselineId(list, baseline(9).id)).toBe(baseline(2).id)
  })

  it('clears to null when nothing is left', () => {
    expect(reconcileSelectedBaselineId([], baseline(1).id)).toBeNull()
  })
})

describe('decision state', () => {
  it('calls a version with only one approval pending, because activation needs both', () => {
    const partly = baseline(2, { decisions: [decision('requirements', 'approved', 'd1', 2)] })
    expect(decisionStateFor(partly, 'requirements')).toBe('approved')
    expect(decisionStateFor(partly, 'design')).toBe('pending')
    expect(overallDecisionState(partly)).toBe('pending')
  })

  it('calls a version approved only when both kinds are approved', () => {
    const both = baseline(2, {
      decisions: [decision('requirements', 'approved', 'd1', 2), decision('design', 'approved', 'd2', 2)],
    })
    expect(overallDecisionState(both)).toBe('approved')
  })

  it('surfaces a rejection even when the other kind was approved', () => {
    const mixed = baseline(2, {
      decisions: [decision('requirements', 'approved', 'd1', 2), decision('design', 'rejected', 'd2', 2)],
    })
    expect(overallDecisionState(mixed)).toBe('rejected')
  })

  it('lets a later approval supersede an earlier rejection of the same kind', () => {
    const corrected = baseline(2, {
      decisions: [decision('design', 'rejected', 'd1', 2), decision('design', 'approved', 'd2', 2)],
    })
    expect(decisionStateFor(corrected, 'design')).toBe('approved')
  })
})
