import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { collectWorkspaceChanges, createThemeRepository } from '../cezarWorkspaceRun'

let root: string

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cezar-workspace-')))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

test('collects only real theme edits, not the byproducts of tools the agent ran', async () => {
  const repository = path.join(root, 'repo')
  const baseCommit = await createThemeRepository(repository, [
    { path: 'templates/front-page.html', bytes: Buffer.from('<p>Services</p>\n') },
    { path: 'tests/smoke.spec.js', bytes: Buffer.from('test\n') },
  ])
  await fs.writeFile(path.join(repository, 'templates/front-page.html'), '<p>Design, Build, Hosting</p>\n')
  await fs.mkdir(path.join(repository, 'test-results'), { recursive: true })
  await fs.writeFile(path.join(repository, 'test-results/.last-run.json'), '{"status":"passed"}\n')
  await fs.mkdir(path.join(repository, 'node_modules/pkg'), { recursive: true })
  await fs.writeFile(path.join(repository, 'node_modules/pkg/index.js'), 'module.exports = 1\n')

  const collected = await collectWorkspaceChanges(repository, baseCommit)

  expect(collected).toEqual({ changes: [{ path: 'templates/front-page.html', content: '<p>Design, Build, Hosting</p>\n' }], deletedPaths: [] })
  expect(execFileSync('git', ['-C', repository, 'log', '--format=%s'], { encoding: 'utf8' }).trim()).toBe('delivery base snapshot')
})
