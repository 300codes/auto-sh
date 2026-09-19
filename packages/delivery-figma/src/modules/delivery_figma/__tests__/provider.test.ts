import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createDeliveryFigmaProvider } from '../lib/provider'
import type { FigmaComment } from '../lib/client'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const projectId = '33333333-3333-4333-8333-333333333333'
const input = { projectId, fileKey: 'file', stageId: 'ux' as const, artifactId: null }

function context(org = organizationId, enabled = true) {
  const resolve = jest.fn(async () => ({ token: `test-${org}`, authType: 'personal' }))
  const snapshot = jest.fn(async () => ({ threads: [], cursor: 'stored-cursor' }))
  const services: Record<string, unknown> = {
    integrationCredentialsService: { resolve },
    integrationStateService: { isEnabled: async () => enabled },
    deliveryOsCommentQueries: { syncSnapshot: snapshot },
  }
  const ctx = { auth: { sub: 'actor', tenantId, orgId: org }, selectedOrganizationId: org,
    container: { resolve: (name: string) => services[name] } } as unknown as CommandRuntimeContext
  return { ctx, resolve, snapshot }
}

function comment(index: number): FigmaComment {
  return { id: String(index), file_key: 'file', message: 'Review', user: { id: 'designer', handle: 'Designer' }, created_at: '2026-09-19T10:00:00.000Z' }
}

it('resolves credentials from each call scope and validates project access before external access', async () => {
  const client = { read: jest.fn(async () => [comment(1)]) }
  const provider = createDeliveryFigmaProvider(client)
  for (const org of [organizationId, '44444444-4444-4444-8444-444444444444']) {
    const harness = context(org)
    await provider.prepare(harness.ctx, input)
    expect(harness.resolve).toHaveBeenCalledWith('delivery_figma', { tenantId, organizationId: org })
    expect(client.read).toHaveBeenLastCalledWith('file', { token: `test-${org}`, authType: 'personal' })
  }
  const denied = context()
  denied.snapshot.mockRejectedValueOnce(new Error('scope denied'))
  await expect(provider.prepare(denied.ctx, input)).rejects.toThrow('scope denied')
  expect(client.read).toHaveBeenCalledTimes(2)
})

it('partitions a complete snapshot into chained batches of at most 200 threads', async () => {
  const provider = createDeliveryFigmaProvider({ read: async () => Array.from({ length: 201 }, (_, index) => comment(index)) })
  const batches = await provider.prepare(context().ctx, input)
  expect(batches.map(({ batch }) => batch.threads.length)).toEqual([200, 1])
  expect(batches[0].batch.cursor.after).toBe('stored-cursor')
  expect(batches[1].batch.cursor.after).toBe(batches[0].batch.cursor.next)
  expect(new Set(batches.map((batch) => batch.idempotencyKey)).size).toBe(2)
  expect(batches.every(({ batch }) => batch.threads.every((thread) => thread.figmaVersion === null))).toBe(true)
})

it('does not fetch from disabled integrations', async () => {
  const read = jest.fn(async () => [])
  await expect(createDeliveryFigmaProvider({ read }).prepare(context(organizationId, false).ctx, input)).rejects.toMatchObject({ status: 422 })
  expect(read).not.toHaveBeenCalled()
})
