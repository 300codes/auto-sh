import { isBroadcastEvent } from '@open-mercato/shared/modules/events'
import features from '../acl'
import { features as indexFeatures, metadata } from '../index'
import setup from '../setup'
import eventsConfig, { DELIVERY_OS_EVENT_IDS } from '../events'
import extensionPoints from '../extension-points'
import {
  DELIVERY_EXECUTION_CONTEXT_CONTRACT,
  DELIVERY_EXECUTION_SPOT_ID,
  DELIVERY_SCHEMA_VERSIONS,
} from '../lib/contracts'
import { FORBIDDEN_IMPORT_PATTERN, findEnterpriseImports } from './enterpriseBoundary'
import { register as registerDi } from '../di'
import { DELIVERY_FLOW_TEMPLATE_PROVIDER_KEY, type DeliveryFlowTemplateProvider } from '../commands/flowTemplateProvider'
import { DEFAULT_FLOW_TEMPLATE } from '../lib/flowTemplates'

const MODULE_ID = 'delivery_os'

const SPEC_FEATURE_IDS = [
  'delivery_os.projects.view',
  'delivery_os.projects.manage',
  'delivery_os.baselines.approve',
  'delivery_os.results.import',
  'delivery_os.attempts.manage',
  'delivery_os.attempts.reconcile',
  'delivery_os.deploy.approve',
  'delivery_os.release.approve',
  'delivery_os.flow.manage',
  'delivery_os.stages.approve',
  'delivery_os.comments.import',
]

const FROZEN_EVENT_IDS = [
  'delivery_os.project.created',
  'delivery_os.baseline.approved',
  'delivery_os.task.updated',
  'delivery_os.evidence.recorded',
]

const FLOW_EVENT_IDS = [
  'delivery_os.flow.pinned',
  'delivery_os.stage.artifact_created',
  'delivery_os.stage.decided',
  'delivery_os.comment_thread.imported',
]

const ALL_EVENT_IDS = [...FROZEN_EVENT_IDS, ...FLOW_EVENT_IDS]

const BROADCAST_EVENT_IDS = [
  'delivery_os.task.updated',
  'delivery_os.evidence.recorded',
  'delivery_os.stage.artifact_created',
  'delivery_os.stage.decided',
]

const EXPECTED_PAYLOAD_PATHS: Record<string, string[]> = {
  'delivery_os.project.created': ['projectId', 'tenantId', 'organizationId'],
  'delivery_os.baseline.approved': [
    'projectId',
    'baselineId',
    'version',
    'contentHash',
    'activeBaselineId',
    'tenantId',
    'organizationId',
  ],
  'delivery_os.task.updated': ['projectId', 'taskId', 'status', 'statusReason', 'updatedAt', 'tenantId', 'organizationId'],
  'delivery_os.evidence.recorded': [
    'projectId',
    'taskId',
    'attemptId',
    'evidenceId',
    'kind',
    'duplicate',
    'completionDelivery',
    'tenantId',
    'organizationId',
  ],
  'delivery_os.flow.pinned': ['projectId', 'templateId', 'templateVersion', 'templateHash', 'tenantId', 'organizationId'],
  'delivery_os.stage.artifact_created': [
    'projectId',
    'stageId',
    'artifactId',
    'version',
    'contentHash',
    'downstreamNowStale',
    'tenantId',
    'organizationId',
  ],
  'delivery_os.stage.decided': ['projectId', 'stageId', 'artifactId', 'decisionId', 'verdict', 'currency', 'tenantId', 'organizationId'],
  'delivery_os.comment_thread.imported': ['projectId', 'threadId', 'staffTaskId', 'outcome', 'tenantId', 'organizationId'],
}

const PII_LIKE_PATHS = /name|email|author|body|text|brief|approver|evidence/i

describe('delivery_os module registration', () => {
  describe('access control', () => {
    it('declares exactly the spec features, once each, owned by the module', () => {
      const ids = features.map((feature) => feature.id)
      expect(ids).toEqual(SPEC_FEATURE_IDS)
      expect(new Set(ids).size).toBe(ids.length)
      for (const feature of features) {
        expect(feature.module).toBe(MODULE_ID)
        expect(feature.title.trim().length).toBeGreaterThan(0)
      }
    })

    it('only depends on declared features', () => {
      const declared = new Set(features.map((feature) => feature.id))
      for (const feature of features) {
        for (const dependency of feature.dependsOn ?? []) {
          expect(declared.has(dependency)).toBe(true)
        }
      }
    })

    it('re-exports the same features from the module index', () => {
      expect(metadata.name).toBe(MODULE_ID)
      expect(indexFeatures).toBe(features)
    })
  })

  describe('default role features', () => {
    const roleFeatures = setup.defaultRoleFeatures ?? {}

    it('grants admin the module wildcard and employee the spec subset', () => {
      expect(roleFeatures.admin).toEqual(['delivery_os.*'])
      expect(roleFeatures.employee).toEqual([
        'delivery_os.projects.view',
        'delivery_os.projects.manage',
        'delivery_os.results.import',
        'delivery_os.comments.import',
      ])
    })

    it('only grants declared features or the module wildcard', () => {
      const allowed = new Set([...SPEC_FEATURE_IDS, `${MODULE_ID}.*`])
      for (const grants of Object.values(roleFeatures)) {
        for (const grant of grants ?? []) {
          expect(allowed.has(grant)).toBe(true)
        }
      }
    })

    it('keeps human decisions and attempt control away from employees', () => {
      const employee = new Set(roleFeatures.employee ?? [])
      for (const privileged of [
        'delivery_os.baselines.approve',
        'delivery_os.attempts.manage',
        'delivery_os.attempts.reconcile',
        'delivery_os.deploy.approve',
        'delivery_os.release.approve',
        'delivery_os.flow.manage',
        'delivery_os.stages.approve',
        'delivery_os.*',
      ]) {
        expect(employee.has(privileged)).toBe(false)
      }
    })
  })

  describe('events', () => {
    it('declares the frozen v1 event ids first and the additive flow ids after them, in module.entity.action form', () => {
      expect(eventsConfig.moduleId).toBe(MODULE_ID)
      expect(DELIVERY_OS_EVENT_IDS).toEqual(ALL_EVENT_IDS)
      expect(DELIVERY_OS_EVENT_IDS.slice(0, FROZEN_EVENT_IDS.length)).toEqual(FROZEN_EVENT_IDS)
      expect(eventsConfig.events.map((event) => event.id)).toEqual(ALL_EVENT_IDS)
      for (const eventId of ALL_EVENT_IDS) {
        expect(eventId).toMatch(/^delivery_os\.[a-z_]+\.[a-z_]+$/)
      }
    })

    it('carries ids only in the flow event payloads (no PII paths)', () => {
      for (const event of eventsConfig.events.filter((candidate) => FLOW_EVENT_IDS.includes(candidate.id))) {
        const paths = (event.payloadSchema?.fields ?? []).map((field) => field.path)
        expect(paths.filter((path) => PII_LIKE_PATHS.test(path))).toEqual([])
      }
    })

    it('broadcasts only live task status, evidence and stage changes to the browser', () => {
      for (const event of eventsConfig.events) {
        const expected = BROADCAST_EVENT_IDS.includes(event.id)
        expect(event.clientBroadcast === true).toBe(expected)
        expect(isBroadcastEvent(event.id)).toBe(expected)
        expect(event.portalBroadcast).toBeUndefined()
      }
    })

    it('declares the spec payload with a required tenant and organization scope', () => {
      for (const event of eventsConfig.events) {
        const fields = event.payloadSchema?.fields ?? []
        expect(fields.map((field) => field.path)).toEqual(EXPECTED_PAYLOAD_PATHS[event.id])
        for (const scopePath of ['tenantId', 'organizationId']) {
          const field = fields.find((candidate) => candidate.path === scopePath)
          expect(field?.optional).toBeUndefined()
        }
      }
    })
  })

  describe('execution extension point', () => {
    it('declares the execution spot with the frozen context contract', () => {
      expect(extensionPoints.moduleId).toBe(MODULE_ID)
      const host = extensionPoints.hosts.projectExecution
      expect(host.spotId).toBe(DELIVERY_EXECUTION_SPOT_ID)
      expect(host.contextContract).toBe(DELIVERY_EXECUTION_CONTEXT_CONTRACT)
      expect(host.contextContract).toBe(DELIVERY_SCHEMA_VERSIONS.executionWidgetContext)
      expect(host.family).toBe('detail')
      expect(host.supported).toEqual(['render-widget'])
      expect(Object.keys(extensionPoints.hosts)).toEqual(['projectScoping', 'projectExecution'])
      expect(extensionPoints.hosts.projectScoping).toMatchObject({ spotId: 'delivery_os.project.scoping', contextContract: 'delivery-scoping-context.v1' })
    })
  })

  describe('DI', () => {
    it('registers the built-in flow template provider that knows only delivery-default@1', async () => {
      const registrations: Record<string, { resolve: (c: unknown) => unknown }> = {}
      const container = { register: (entries: typeof registrations) => Object.assign(registrations, entries) }
      registerDi(container as unknown as Parameters<typeof registerDi>[0])
      const provider = registrations[DELIVERY_FLOW_TEMPLATE_PROVIDER_KEY].resolve({}) as DeliveryFlowTemplateProvider
      await expect(provider.getTemplate(DEFAULT_FLOW_TEMPLATE.templateId, DEFAULT_FLOW_TEMPLATE.version)).resolves.toBe(DEFAULT_FLOW_TEMPLATE)
      await expect(provider.getTemplate(DEFAULT_FLOW_TEMPLATE.templateId, 2)).resolves.toBeNull()
      await expect(provider.getTemplate('other', 1)).resolves.toBeNull()
    })
  })

  describe('OSS/enterprise boundary', () => {
    it('recognises forbidden import forms', () => {
      expect(FORBIDDEN_IMPORT_PATTERN.test(`import x from '@open-mercato/enterprise/modules/x'`)).toBe(true)
      expect(FORBIDDEN_IMPORT_PATTERN.test(`const x = await import("@open-mercato/delivery-cezar")`)).toBe(true)
      expect(FORBIDDEN_IMPORT_PATTERN.test(`require('@open-mercato/enterprise')`)).toBe(true)
      expect(FORBIDDEN_IMPORT_PATTERN.test(`import '../../delivery-cezar/lib'`)).toBe(true)
      expect(FORBIDDEN_IMPORT_PATTERN.test(`import x from '../../../../enterprise/src/modules/x'`)).toBe(true)
      expect(FORBIDDEN_IMPORT_PATTERN.test('const x = await import(`@open-mercato/enterprise/x`)')).toBe(true)
      expect(FORBIDDEN_IMPORT_PATTERN.test(`require.resolve('@open-mercato/enterprise')`)).toBe(true)
      expect(FORBIDDEN_IMPORT_PATTERN.test(`import x from '../lib/contracts'`)).toBe(false)
      expect(FORBIDDEN_IMPORT_PATTERN.test(`import x from '@open-mercato/shared/lib/x'`)).toBe(false)
    })

    it('has no module file importing enterprise or delivery-cezar code', () => {
      expect(findEnterpriseImports([__filename])).toEqual([])
    })
  })
})
