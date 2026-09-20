import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export type CezarWorkspaceConfig = {
  command: string
  args: readonly string[]
  port: number
  workflow: string
  timeoutMs: number
  pollMs?: number
}

export type WorkspaceFile = { path: string; bytes: Uint8Array }

export type CezarWorkspaceResult = {
  runId: string
  status: 'done' | 'review'
  changes: Array<{ path: string; content: string; encoding: 'utf8' | 'base64' }>
  deletedPaths: string[]
}

const TERMINAL_STATUSES = new Set(['done', 'review', 'failed', 'cancelled', 'waiting'])
const TOOL_BYPRODUCTS = ['test-results/', 'playwright-report/', 'blob-report/', 'node_modules/', 'vendor/', '.DS_Store']
const GIT_IDENTITY = ['-c', 'user.email=delivery-agents@open-mercato.local', '-c', 'user.name=delivery-agents']

function run(command: string, args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], { cwd, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(new Error(`[internal] ${command} ${args[0] ?? ''} failed: ${error.message}`))
      else resolve(stdout)
    })
  })
}

function git(cwd: string, ...args: string[]): Promise<string> {
  return run('git', [...GIT_IDENTITY, ...args], cwd)
}

export async function createThemeRepository(directory: string, files: readonly WorkspaceFile[]): Promise<string> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  for (const file of files) {
    const target = path.resolve(directory, file.path)
    if (!target.startsWith(`${directory}${path.sep}`)) throw new Error('[internal] cezar_workspace_path_invalid')
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    await fs.writeFile(target, file.bytes, { mode: 0o600, flag: 'wx' })
  }
  await fs.writeFile(path.join(directory, '.gitignore'), `${TOOL_BYPRODUCTS.join('\n')}\n`, { mode: 0o600, flag: 'a' })
  await git(directory, 'init', '-q', '-b', 'main')
  await git(directory, 'add', '-A')
  await git(directory, 'commit', '-q', '-m', 'delivery base snapshot')
  return (await git(directory, 'rev-parse', 'HEAD')).trim()
}

async function readJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(`[internal] cezar_api_${response.status}`)
  return (await response.json()) as Record<string, unknown>
}

async function waitForHealth(baseUrl: string, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    const healthy = await fetch(`${baseUrl}/api/v1/health`).then((response) => response.ok, () => false)
    if (healthy) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('[internal] cezar_server_unavailable')
}

function stopServer(server: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (server.exitCode !== null || server.signalCode !== null) return resolve()
    server.once('exit', () => resolve())
    server.kill('SIGTERM')
    setTimeout(() => {
      if (server.exitCode === null) server.kill('SIGKILL')
    }, 5000).unref()
  })
}

async function worktreeForBranch(repository: string, branch: string): Promise<string> {
  const listing = await git(repository, 'worktree', 'list', '--porcelain')
  for (const block of listing.split('\n\n')) {
    const lines = block.split('\n')
    const worktree = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length)
    if (lines.includes(`branch refs/heads/${branch}`) && worktree) return worktree
  }
  throw new Error('[internal] cezar_worktree_missing')
}

/**
 * Reads a changed file as bytes and only calls it text when it survives a UTF-8 round trip, so a font or any other
 * binary the task legitimately adds reaches the operator intact instead of being mangled into replacement characters.
 */
function encodeChange(bytes: Buffer): { content: string; encoding: 'utf8' | 'base64' } {
  const text = bytes.toString('utf8')
  return Buffer.from(text, 'utf8').equals(bytes) ? { content: text, encoding: 'utf8' } : { content: bytes.toString('base64'), encoding: 'base64' }
}

export async function collectWorkspaceChanges(worktree: string, baseCommit: string): Promise<Pick<CezarWorkspaceResult, 'changes' | 'deletedPaths'>> {
  await git(worktree, 'add', '-A')
  const status = await git(worktree, 'diff', '--cached', '--name-status', '--no-renames', baseCommit)
  const changes: CezarWorkspaceResult['changes'] = []
  const deletedPaths: string[] = []
  for (const line of status.split('\n').filter(Boolean)) {
    const [kind, filePath] = line.split('\t')
    if (!filePath || filePath.startsWith('.ai/') || filePath === '.gitignore') continue
    if (kind === 'D') { deletedPaths.push(filePath); continue }
    const bytes = await fs.readFile(path.join(worktree, filePath))
    changes.push({ path: filePath, ...encodeChange(bytes) })
  }
  return { changes, deletedPaths }
}

export async function runCezarInWorkspace(repository: string, baseCommit: string, prompt: string, config: CezarWorkspaceConfig): Promise<CezarWorkspaceResult> {
  const baseUrl = `http://127.0.0.1:${config.port}`
  const server = spawn(config.command, [...config.args, '--no-open', '-p', String(config.port)], {
    cwd: repository,
    env: { ...process.env, CEZ_NO_BANNER: '1', CEZ_SINGLE_PROJECT: '1' },
    stdio: 'ignore',
  })
  const deadline = Date.now() + config.timeoutMs
  try {
    await waitForHealth(baseUrl, Math.min(deadline, Date.now() + 120_000))
    const created = await readJson(`${baseUrl}/api/v1/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: prompt, workflow: config.workflow, autonomous: true, worktree: true, generateFollowups: false }),
    })
    const runId = typeof created.id === 'string' ? created.id : ''
    if (!runId) throw new Error('[internal] cezar_run_not_created')
    let record: Record<string, unknown> = created
    while (!TERMINAL_STATUSES.has(String(record.status))) {
      if (Date.now() > deadline) {
        await fetch(`${baseUrl}/api/v1/runs/${runId}/cancel`, { method: 'POST' }).catch(() => undefined)
        throw new Error('[internal] cezar_run_timeout')
      }
      await new Promise((resolve) => setTimeout(resolve, config.pollMs ?? 2000))
      const read = await readJson(`${baseUrl}/api/v1/runs/${runId}`)
      record = (read.run as Record<string, unknown> | undefined) ?? read
    }
    const status = String(record.status)
    if (status !== 'done' && status !== 'review') throw new Error(`[internal] cezar_run_${status}`)
    const branch = typeof record.branch === 'string' ? record.branch : ''
    if (!branch) throw new Error('[internal] cezar_run_branch_missing')
    const worktree = await worktreeForBranch(repository, branch)
    return { runId, status, ...(await collectWorkspaceChanges(worktree, baseCommit)) }
  } finally {
    await stopServer(server)
  }
}
