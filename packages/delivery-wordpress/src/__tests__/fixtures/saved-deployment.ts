import { promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { captureOwnedDeploymentPackage } from '../../deployment-manifest.ts'
import { requestHashFor, siteIdFor, writeRecord } from '../../ownership.ts'
import type { CommandRunner } from '../../runner.ts'

export async function savedDeploymentFixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wp-saved-package-'))
  const config = { sitesRoot: path.join(directory, 'sites'), stateRoot: path.join(directory, 'state') }
  const scope = { tenantId: randomUUID(), organizationId: randomUUID(), projectId: randomUUID() }
  const handle = { siteId: siteIdFor(scope) }
  const sitePath = path.join(config.sitesRoot, handle.siteId)
  const statePath = path.join(config.stateRoot, handle.siteId)
  for (const folder of [config.sitesRoot, config.stateRoot, sitePath, statePath]) await fs.mkdir(folder, { mode: 0o700 })
  const request = { scope, attemptId: randomUUID(), idempotencyKey: 'saved', name: 'Saved fixture', themeSlug: 'fixture' }
  await writeRecord(statePath, { schemaVersion: 1, request, requestHash: requestHashFor(request), status: 'ready', result: {
    schemaVersion: 1, provenance: 'fixture', siteId: handle.siteId, scope, attemptId: request.attemptId, toolExecutionId: randomUUID(), studioSiteId: 'fixture-studio', localUrl: 'http://localhost:9999', themeSlug: 'fixture', themeCommit: 'a'.repeat(40), createdAt: new Date().toISOString(), checks: [],
  } })
  const content = path.join(sitePath, 'wp-content')
  for (const [relative, bytes] of [['themes/fixture/index.php', '<?php echo "fixture";'], ['uploads/image.png', 'fixture image']]) {
    const filename = path.join(content, relative!)
    await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
    await fs.writeFile(filename, bytes!)
  }
  await fs.mkdir(path.join(content, 'database'), { mode: 0o700 })
  const database = new DatabaseSync(path.join(content, 'database/.ht.sqlite'))
  database.exec("CREATE TABLE own_content (value TEXT); INSERT INTO own_content VALUES ('fixture');")
  database.close()
  const runner: CommandRunner = async () => ({ stdout: JSON.stringify([{ id: 'fixture-studio', path: sitePath, running: false }]), exitCode: 0 })
  const captured = await captureOwnedDeploymentPackage({ scope, handle, config, runtimeIdentity: { wordpressVersion: '7.1.1', phpVersion: '8.4', studioVersion: '1.19.0' } }, { runner })
  const packageDirectory = path.join(statePath, 'deployment-packages', captured.packageId)
  const manifestFile = path.join(packageDirectory, 'manifest.json')
  const input = { scope, handle, config, packageId: captured.packageId, expectedPackageHash: captured.packageHash }
  const editManifest = async (edit: (manifest: typeof captured.manifest) => void) => {
    const manifest = structuredClone(captured.manifest)
    edit(manifest)
    const packageHash = createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
    await fs.writeFile(manifestFile, JSON.stringify({ ...manifest, packageHash }))
    return { ...input, expectedPackageHash: packageHash }
  }
  return { directory, statePath, sitePath, packageDirectory, manifestFile, input, captured, editManifest,
    filename: (relative: string) => path.join(packageDirectory, 'site', relative),
    dispose: () => fs.rm(directory, { recursive: true, force: true }) }
}
