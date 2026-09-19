export type IssuedTrustedExecution = Readonly<{ source: 'delivery_agents'; actorUserId: string }>

const REGISTRY_KEY = Symbol.for('open-mercato.delivery_os.trustedExecutions')

type RegistryHost = typeof globalThis & { [REGISTRY_KEY]?: WeakSet<object> }

function issuedRegistry(): WeakSet<object> {
  const host = globalThis as RegistryHost
  if (!host[REGISTRY_KEY]) host[REGISTRY_KEY] = new WeakSet<object>()
  return host[REGISTRY_KEY]
}

export function issueTrustedExecution(actorUserId: string): IssuedTrustedExecution {
  const issued: IssuedTrustedExecution = Object.freeze({ source: 'delivery_agents', actorUserId })
  issuedRegistry().add(issued)
  return issued
}

export function isIssuedTrustedExecution(value: unknown): value is IssuedTrustedExecution {
  return typeof value === 'object' && value !== null && issuedRegistry().has(value)
}

export function readTrustedExecutionOption(rawInput: unknown): unknown {
  return typeof rawInput === 'object' && rawInput !== null ? (rawInput as Record<string, unknown>).trustedExecution : undefined
}
