import { constants, promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { mapWordpressResult, type WordpressResultMappingInput } from '@open-mercato/core/modules/delivery_os/lib/wordpressResultMapper'

const configurationSchema = z.strictObject({
  operatorRoot: z.string().refine(path.isAbsolute),
  stateRoot: z.string().refine(path.isAbsolute),
})
type FrozenInput = WordpressResultMappingInput['base']
type SnapshotReference = { snapshotId: string; snapshot: FrozenInput['snapshot'] }
type MappingInput = Pick<WordpressResultMappingInput, 'taskPackage' | 'trusted' | 'execution' | 'checks' | 'usage'> & {
  base: SnapshotReference
  result: SnapshotReference
  config: z.input<typeof configurationSchema>
}

async function assertOperatorPath(filename: string, directory: boolean) {
  const normalized = path.resolve(filename)
  if (normalized !== filename || await fs.realpath(filename) !== filename) throw new Error('[internal] wordpress_operator_path_invalid')
  const metadata = await fs.lstat(filename)
  if (metadata.isSymbolicLink() || (directory ? !metadata.isDirectory() : !metadata.isFile() || metadata.nlink !== 1 || metadata.size > 1024 * 1024)) throw new Error('[internal] wordpress_operator_path_invalid')
}

async function loadReader(operatorRoot: string): Promise<(input: unknown) => Promise<unknown>> {
  await assertOperatorPath(operatorRoot, true)
  await assertOperatorPath(path.join(operatorRoot, 'dist'), true)
  const readerFile = path.join(operatorRoot, 'dist/snapshot-reader.js')
  await assertOperatorPath(readerFile, false)
  const metadataFile = path.join(operatorRoot, 'package.json')
  const handle = await fs.open(metadataFile, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 64 * 1024) throw new Error('[internal] wordpress_operator_metadata_invalid')
    const metadata: unknown = JSON.parse(await handle.readFile('utf8'))
    if (!z.object({ name: z.literal('@open-mercato/delivery-wordpress') }).safeParse(metadata).success) {
      throw new Error('[internal] wordpress_operator_mismatch')
    }
  } finally { await handle.close() }
  const module: unknown = await import(pathToFileURL(readerFile).href)
  if (!module || typeof module !== 'object' || !('readOwnedSnapshotArtifacts' in module) || typeof module.readOwnedSnapshotArtifacts !== 'function') {
    throw new Error('[internal] wordpress_snapshot_reader_unavailable')
  }
  return module.readOwnedSnapshotArtifacts as (input: unknown) => Promise<unknown>
}

export async function mapOwnedWordpressResult(input: MappingInput) {
  const config = configurationSchema.parse(input.config)
  const artifactPaths = new Set<string>()
  function includeArtifact(artifactPath: string) {
    artifactPaths.add(artifactPath)
    if (artifactPaths.size > 200) throw new Error('[internal] wordpress_result_artifact_count_limit')
  }
  for (const frozen of [input.base, input.result]) {
    const prefix = `snapshots/${frozen.snapshotId}`
    includeArtifact(`${prefix}/database.sqlite`)
    for (const name of Object.keys(frozen.snapshot.themeFiles)) includeArtifact(`${prefix}/theme/${name}`)
  }
  for (const check of input.checks) {
    includeArtifact(check.definition.path)
    includeArtifact(check.report.path)
  }
  const readSnapshot = await loadReader(config.operatorRoot)
  const common = {
    scope: input.trusted.scope,
    handle: { siteId: input.trusted.siteId },
    config: { stateRoot: config.stateRoot },
  }
  const base = await readSnapshot({ ...common, ...input.base })
  const result = await readSnapshot({ ...common, ...input.result })
  return mapWordpressResult({
    taskPackage: input.taskPackage, trusted: input.trusted, execution: input.execution,
    checks: input.checks, usage: input.usage,
    base: base as FrozenInput, result: result as FrozenInput,
  })
}
