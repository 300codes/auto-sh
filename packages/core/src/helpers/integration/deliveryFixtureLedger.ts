export type DeliveryFixtureResource = {
  kind: 'tenant' | 'organization' | 'role' | 'user' | 'project' | 'attachment' | 'task'
  id: string
  tenantId?: string
  organizationId?: string
}

export type DeliveryCleanupEntry = DeliveryFixtureResource & {
  state: 'pending' | 'cleaned'
  retained: boolean
}

export type DeliveryCleanupReport = {
  resources: DeliveryCleanupEntry[]
  failures: Array<DeliveryFixtureResource & { reason: 'cleanup_failed' | 'dependent_pending' }>
  retainedHistory: Array<{ kind: string; id: string; tenantId: string; organizationId: string }>
  physicalCleanup: 'pending_environment_disposal'
}

export function createDeliveryFixtureLedger() {
  const entries: Array<{
    resource: DeliveryCleanupEntry
    dependsOn: string[]
    cleanup: () => Promise<void>
  }> = []
  const retainedHistory: DeliveryCleanupReport['retainedHistory'] = []
  let inFlight: Promise<DeliveryCleanupReport> | undefined

  function register(resource: DeliveryFixtureResource, dependsOn: string[], cleanup: () => Promise<void>, retained = true): void {
    if (inFlight) throw new Error('[internal] Cannot register resources during fixture cleanup')
    if (entries.some((entry) => entry.resource.id === resource.id)) {
      throw new Error('[internal] Duplicate delivery fixture resource')
    }
    if (dependsOn.some((id) => !entries.some((entry) => entry.resource.id === id))) {
      throw new Error('[internal] Delivery fixture dependency must be registered first')
    }
    entries.push({ resource: { ...resource, state: 'pending', retained }, dependsOn: [...dependsOn], cleanup })
  }

  function snapshot(): DeliveryCleanupEntry[] {
    return entries.map(({ resource }) => ({ ...resource }))
  }

  async function performCleanup(): Promise<DeliveryCleanupReport> {
    const failures: DeliveryCleanupReport['failures'] = []
    const priority: Record<DeliveryFixtureResource['kind'], number> = { task: 0, project: 1, attachment: 2, user: 3, role: 4, organization: 5, tenant: 6 }
    for (const entry of [...entries].reverse().sort((left, right) => priority[left.resource.kind] - priority[right.resource.kind])) {
      if (entry.resource.state === 'cleaned') continue
      const pendingDependent = entries.some((candidate) =>
        candidate.resource.state === 'pending' && candidate.dependsOn.includes(entry.resource.id),
      )
      if (pendingDependent) {
        failures.push({ ...entry.resource, reason: 'dependent_pending' })
        continue
      }
      try {
        await entry.cleanup()
        entry.resource.state = 'cleaned'
      } catch {
        failures.push({ ...entry.resource, reason: 'cleanup_failed' })
      }
    }
    return {
      resources: snapshot(),
      failures,
      retainedHistory: retainedHistory.map((resource) => ({ ...resource })),
      physicalCleanup: 'pending_environment_disposal',
    }
  }

  function cleanup(): Promise<DeliveryCleanupReport> {
    if (!inFlight) inFlight = performCleanup().finally(() => { inFlight = undefined })
    return inFlight
  }

  return {
    register,
    snapshot,
    cleanup,
    retain(resource: DeliveryCleanupReport['retainedHistory'][number]): void {
      retainedHistory.push({ ...resource })
    },
  }
}
