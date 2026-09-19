export {
  taskPackageSchema,
  resultManifestSchema,
  sourceRevisionSchema,
  parseTaskPackage,
  parseResultManifest,
} from './lib/contracts'
export type { TaskPackage, ResultManifest, SourceRevision } from './lib/contracts'

export { runCezarTask } from './lib/runner'
export type { CezarRunOptions, CezarRunResult } from './lib/runner'

export { mapCezarRunToResultManifest } from './lib/resultManifest'
export type { MapResultOptions } from './lib/resultManifest'

export { redactTaskPackageForLogs, redactResultManifestForLogs, redactCliArgsForLogs } from './lib/logRedaction'
