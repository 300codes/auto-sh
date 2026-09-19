import type { CezarRunResult } from './runner'
import type { ResultManifest, TaskPackage } from './contracts'
import { resultManifestSchema } from './contracts'

export type MapResultOptions = {
  pkg: TaskPackage
  runResult: CezarRunResult
  resultCommit?: string
  changedPaths?: string[]
}

export function mapCezarRunToResultManifest(opts: MapResultOptions): ResultManifest {
  const { pkg, runResult, resultCommit, changedPaths = [] } = opts

  const raw: ResultManifest = {
    schemaVersion: '1',
    taskId: pkg.taskId,
    attemptId: pkg.attemptId,
    baselineId: pkg.baselineId,
    baselineHash: pkg.baselineHash,
    externalRunId: runResult.runId,
    baseCommit: pkg.baseCommit,
    resultCommit,
    changedPaths,
    artifacts: [],
    checks: [],
    agentDeclaration: extractAgentDeclaration(runResult.stdout),
    findings: [],
    usage: extractUsage(runResult.stdout),
    sourceRevision: pkg.baseCommit
      ? { kind: 'git', commitSha: resultCommit ?? pkg.baseCommit }
      : { kind: 'snapshot', contentHash: pkg.baselineHash, externalWorkspaceId: pkg.attemptId },
  }

  return resultManifestSchema.parse(raw)
}

function extractAgentDeclaration(stdout: string): string | undefined {
  const match = stdout.match(/runner:\s*(\w+)/i)
  return match ? `cezar/${match[1]}` : undefined
}

function extractUsage(stdout: string): ResultManifest['usage'] {
  const match = stdout.match(/(\d+)\s+tokens/)
  if (!match) return [{ source: 'cezar', costUsd: 'unknown' }]

  return [
    {
      source: 'cezar',
      outputTokens: parseInt(match[1], 10),
      costUsd: 'unknown',
    },
  ]
}
