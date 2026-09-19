import type { ResultManifestV1, TaskPackageV1 } from '@open-mercato/core/modules/delivery_os/lib/contracts'

export const DELIVERY_AGENTS_EXECUTION_HOST_KEY = 'deliveryAgentsExecutionHost'

export type ExecutionHostScope = { tenantId: string; organizationId: string }

export type ExecutionHostInput = {
  taskPackage: TaskPackageV1
  scope: ExecutionHostScope
  actorUserId: string
  baseDir: string
}

export type DeliveryAgentsExecutionHost = {
  supports(targetProfileId: string, targetProfileVersion: number): boolean
  execute(input: ExecutionHostInput): Promise<ResultManifestV1>
}

type ContainerLike = { resolve: (name: string) => unknown }

export function tryResolveExecutionHost(container: ContainerLike): DeliveryAgentsExecutionHost | null {
  try {
    const host = container.resolve(DELIVERY_AGENTS_EXECUTION_HOST_KEY) as DeliveryAgentsExecutionHost | null
    return host && typeof host.execute === 'function' && typeof host.supports === 'function' ? host : null
  } catch {
    return null
  }
}
