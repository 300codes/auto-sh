import type { TaskPackage, ResultManifest } from './contracts'

type RedactedTaskPackage = Omit<TaskPackage, 'idempotencyKey' | 'repositoryRef'> & {
  idempotencyKey: '[REDACTED]'
  repositoryRef?: { url: string; branch?: string }
}

type RedactedResultManifest = Omit<ResultManifest, 'usage'> & {
  usage: Array<{ source: string; inputTokens?: number; outputTokens?: number; costUsd?: number | 'unknown' }>
}

export function redactTaskPackageForLogs(pkg: TaskPackage): RedactedTaskPackage {
  const { repositoryRef, ...rest } = pkg

  return {
    ...rest,
    idempotencyKey: '[REDACTED]',
    repositoryRef: repositoryRef ? { url: repositoryRef.url, branch: repositoryRef.branch } : undefined,
  }
}

export function redactResultManifestForLogs(manifest: ResultManifest): RedactedResultManifest {
  return {
    ...manifest,
    usage: manifest.usage.map(({ source, inputTokens, outputTokens, costUsd }) => ({
      source,
      inputTokens,
      outputTokens,
      costUsd,
    })),
  }
}

export function redactCliArgsForLogs(args: readonly string[]): string[] {
  return args.map((arg, i) => {
    const prev = args[i - 1]
    if (prev === '--token' || prev === '--api-key' || prev === '--secret') return '[REDACTED]'
    return arg
  })
}
