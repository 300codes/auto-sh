import { createDeliveryFixtureLedger } from '../deliveryFixtureLedger'

describe('delivery fixture cleanup ownership and recovery', () => {
  it('cleans reverse task dependencies before projects, files and identities; repeated cleanup does nothing', async () => {
    const ledger = createDeliveryFixtureLedger()
    const calls: string[] = []
    const add = (kind: Parameters<typeof ledger.register>[0]['kind'], id: string, dependencies: string[]) => {
      ledger.register({ kind, id }, dependencies, async () => { calls.push(id) })
    }
    add('tenant', 'tenant', [])
    add('organization', 'org', ['tenant'])
    add('role', 'role', ['org'])
    add('user', 'user', ['role'])
    add('project', 'project', ['user'])
    add('attachment', 'file', ['user'])
    add('task', 'parent', ['project'])
    add('task', 'child', ['parent', 'project'])
    ledger.retain({ kind: 'attempt', id: 'attempt', tenantId: 'tenant', organizationId: 'org' })
    const first = await ledger.cleanup()
    expect(first.failures).toEqual([])
    expect(calls).toEqual(['child', 'parent', 'project', 'file', 'user', 'role', 'org', 'tenant'])
    expect(await ledger.cleanup()).toEqual(first)
    expect(calls).toHaveLength(8)
    expect(first.physicalCleanup).toBe('pending_environment_disposal')
    expect(first.retainedHistory).toHaveLength(1)
  })

  it('preserves parents after a failure, cleans independent resources and retries only pending resources', async () => {
    const ledger = createDeliveryFixtureLedger()
    let fail = true
    const parent = jest.fn(async () => {})
    const foreign = jest.fn(async () => {})
    ledger.register({ kind: 'tenant', id: 'parent' }, [], parent)
    ledger.register({ kind: 'tenant', id: 'independent' }, [], foreign)
    ledger.register({ kind: 'project', id: 'child' }, ['parent'], async () => {
      if (fail) throw new Error('secret credential must not be reported')
    })
    const first = await ledger.cleanup()
    expect(parent).not.toHaveBeenCalled()
    expect(foreign).toHaveBeenCalledTimes(1)
    expect(first.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'child', reason: 'cleanup_failed' }),
      expect.objectContaining({ id: 'parent', reason: 'dependent_pending' }),
    ]))
    expect(JSON.stringify(first)).not.toContain('secret')
    fail = false
    expect((await ledger.cleanup()).failures).toEqual([])
    expect(parent).toHaveBeenCalledTimes(1)
    expect(foreign).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent cleanup and refuses registration while cleanup is pending', async () => {
    const ledger = createDeliveryFixtureLedger()
    let release: () => void = () => {}
    const barrier = new Promise<void>((resolve) => { release = resolve })
    const cleanup = jest.fn(() => barrier)
    ledger.register({ kind: 'tenant', id: 'tenant' }, [], cleanup)
    const first = ledger.cleanup()
    const second = ledger.cleanup()
    expect(first).toBe(second)
    expect(() => ledger.register({ kind: 'tenant', id: 'late' }, [], async () => {})).toThrow(/during fixture cleanup/)
    release()
    await first
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('rejects unowned dependencies and duplicate ids before accepting cleanup callbacks', () => {
    const ledger = createDeliveryFixtureLedger()
    expect(() => ledger.register({ kind: 'project', id: 'project' }, ['missing'], async () => {})).toThrow(/registered first/)
    ledger.register({ kind: 'tenant', id: 'tenant' }, [], async () => {})
    expect(() => ledger.register({ kind: 'tenant', id: 'tenant' }, [], async () => {})).toThrow(/Duplicate/)
    expect(ledger.snapshot()).toHaveLength(1)
  })
})
