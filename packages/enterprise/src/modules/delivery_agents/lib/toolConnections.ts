import { spawn, type ChildProcess } from 'node:child_process'
import { hostname } from 'node:os'
import { delimiter } from 'node:path'

export const TOOL_IDS = ['codex', 'claude', 'wordpress_studio', 'figma_mcp'] as const
export type ToolId = (typeof TOOL_IDS)[number]

export const TOOL_ACTIONS = ['check', 'connect', 'cancel', 'disconnect'] as const
export type ToolAction = (typeof TOOL_ACTIONS)[number]

export type ToolConnectionState =
  | 'not_installed'
  | 'not_connected'
  | 'pending_login'
  | 'connected'
  | 'expired'
  | 'error'

export type ToolConnectionDetail =
  | 'requires_codex'
  | 'mcp_not_configured'
  | 'mcp_disabled'
  | 'mcp_no_auth_required'
  | 'status_unreadable'
  | 'status_timeout'

export type LoginOutcome = 'success' | 'failed' | 'cancelled' | 'timeout'

export type ToolConnectionStatus = {
  id: ToolId
  host: string
  installed: boolean
  version: string | null
  state: ToolConnectionState
  account: string | null
  detail: ToolConnectionDetail | null
  loginUrl: string | null
  lastCheckedAt: string
  lastLogin: { outcome: LoginOutcome; finishedAt: string } | null
}

export type CommandResult = {
  exitCode: number | null
  output: string
  notFound: boolean
  timedOut: boolean
}

export type CommandRunner = (bin: string, args: readonly string[], timeoutMs?: number) => Promise<CommandResult>

type LoginProcess = {
  kill: () => void
  onExit: (listener: (exitCode: number | null) => void) => void
  onOutput: (listener: (chunk: string) => void) => void
}

export type LoginSpawner = (bin: string, args: readonly string[]) => LoginProcess

type PendingLogin = { process: LoginProcess; output: string; loginUrl: string | null; timer: ReturnType<typeof setTimeout> }

type ToolConnectionsRegistry = {
  pending: Map<ToolId, PendingLogin>
  lastLogin: Map<ToolId, { outcome: LoginOutcome; finishedAt: string }>
}

const STATUS_TIMEOUT_MS = 20_000
const LOGIN_TIMEOUT_MS = 10 * 60_000
const FIGMA_MCP_NAME = 'figma'
const FIGMA_MCP_DEFAULT_URL = 'https://mcp.figma.com/mcp'
const EXTRA_PATH_ENTRIES = ['/opt/homebrew/bin', '/usr/local/bin']
const ANSI_PATTERN = /\u001b\[[0-9;?]*[A-Za-z]/g
const VERSION_PATTERN = /\d+\.\d+\.\d+(?:[-+][\w.]+)?/g
const URL_PATTERN = /https:\/\/[^\s"'<>`]+/
const CONNECTED_MCP_AUTH = new Set(['o_auth', 'oauth', 'bearer_token'])

const TOOL_BINARIES: Record<ToolId, string> = {
  codex: 'codex',
  claude: 'claude',
  wordpress_studio: 'studio',
  figma_mcp: 'codex',
}

const LOGIN_ARGS: Record<ToolId, readonly string[]> = {
  codex: ['login'],
  claude: ['auth', 'login'],
  wordpress_studio: ['auth', 'login'],
  figma_mcp: ['mcp', 'login', FIGMA_MCP_NAME],
}

const LOGOUT_ARGS: Record<ToolId, readonly string[]> = {
  codex: ['logout'],
  claude: ['auth', 'logout'],
  wordpress_studio: ['auth', 'logout'],
  figma_mcp: ['mcp', 'logout', FIGMA_MCP_NAME],
}

const registryKey = Symbol.for('open-mercato.delivery_agents.toolConnections')

function registry(): ToolConnectionsRegistry {
  const holder = globalThis as typeof globalThis & { [registryKey]?: ToolConnectionsRegistry }
  if (!holder[registryKey]) holder[registryKey] = { pending: new Map(), lastLogin: new Map() }
  return holder[registryKey]
}

export function isToolId(value: unknown): value is ToolId {
  return typeof value === 'string' && (TOOL_IDS as readonly string[]).includes(value)
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}

export function parseVersion(output: string): string | null {
  const matches = stripAnsi(output).match(VERSION_PATTERN)
  return matches && matches.length > 0 ? matches[matches.length - 1] : null
}

export function extractLoginUrl(output: string): string | null {
  const match = stripAnsi(output).match(URL_PATTERN)
  return match ? match[0].replace(/[).,;]+$/, '') : null
}

function figmaMcpUrl(): string {
  return process.env.DELIVERY_FIGMA_MCP_URL?.trim() || FIGMA_MCP_DEFAULT_URL
}

function toolEnv(): NodeJS.ProcessEnv {
  const configured = process.env.DELIVERY_TOOLS_PATH?.split(delimiter).filter(Boolean) ?? []
  const current = process.env.PATH?.split(delimiter).filter(Boolean) ?? []
  const path = [...configured, ...current, ...EXTRA_PATH_ENTRIES.filter((entry) => !current.includes(entry))]
  return { ...process.env, PATH: path.join(delimiter), NO_COLOR: '1', FORCE_COLOR: '0' }
}

export const defaultCommandRunner: CommandRunner = (bin, args, timeoutMs = STATUS_TIMEOUT_MS) =>
  new Promise((resolve) => {
    const chunks: Buffer[] = []
    let settled = false
    const finish = (result: Omit<CommandResult, 'output'>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ...result, output: Buffer.concat(chunks).toString('utf8') })
    }
    const child = spawn(bin, [...args], { env: toolEnv(), shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish({ exitCode: null, notFound: false, timedOut: true })
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('error', (error: NodeJS.ErrnoException) =>
      finish({ exitCode: null, notFound: error.code === 'ENOENT', timedOut: false }),
    )
    child.on('close', (code) => finish({ exitCode: code, notFound: false, timedOut: false }))
  })

export const defaultLoginSpawner: LoginSpawner = (bin, args) => {
  const child: ChildProcess = spawn(bin, [...args], { env: toolEnv(), shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
  const exitListeners: Array<(exitCode: number | null) => void> = []
  let exited = false
  const emitExit = (code: number | null) => {
    if (exited) return
    exited = true
    for (const listener of exitListeners) listener(code)
  }
  child.on('error', () => emitExit(null))
  child.on('close', (code) => emitExit(code))
  return {
    kill: () => {
      if (!exited) child.kill('SIGTERM')
    },
    onExit: (listener) => exitListeners.push(listener),
    onOutput: (listener) => {
      child.stdout?.on('data', (chunk: Buffer) => listener(chunk.toString('utf8')))
      child.stderr?.on('data', (chunk: Buffer) => listener(chunk.toString('utf8')))
    },
  }
}

type AuthProbe = { state: ToolConnectionState; account: string | null; detail: ToolConnectionDetail | null }

function unreadable(result: CommandResult): AuthProbe {
  return { state: 'error', account: null, detail: result.timedOut ? 'status_timeout' : 'status_unreadable' }
}

export function interpretCodexLogin(result: CommandResult): AuthProbe {
  if (result.timedOut) return unreadable(result)
  const text = stripAnsi(result.output)
  if (/expired|refresh token/i.test(text)) return { state: 'expired', account: null, detail: null }
  if (result.exitCode === 0 && /logged in/i.test(text) && !/not logged in/i.test(text)) {
    const method = text.match(/logged in using ([^\n]+)/i)?.[1]?.trim() ?? null
    return { state: 'connected', account: method, detail: null }
  }
  return { state: 'not_connected', account: null, detail: null }
}

export function interpretClaudeAuth(result: CommandResult): AuthProbe {
  if (result.timedOut) return unreadable(result)
  const text = stripAnsi(result.output)
  const jsonStart = text.indexOf('{')
  if (jsonStart < 0) return result.exitCode === 0 ? unreadable(result) : { state: 'not_connected', account: null, detail: null }
  try {
    const parsed: unknown = JSON.parse(text.slice(jsonStart, text.lastIndexOf('}') + 1))
    if (typeof parsed !== 'object' || parsed === null) return unreadable(result)
    const record = parsed as Record<string, unknown>
    if (record.loggedIn !== true) return { state: 'not_connected', account: null, detail: null }
    const account =
      typeof record.email === 'string' ? record.email : typeof record.authMethod === 'string' ? record.authMethod : null
    return { state: 'connected', account, detail: null }
  } catch {
    return unreadable(result)
  }
}

export function interpretStudioAuth(result: CommandResult): AuthProbe {
  if (result.timedOut) return unreadable(result)
  const text = stripAnsi(result.output)
  if (/expired|wygas/i.test(text)) return { state: 'expired', account: null, detail: null }
  const account = text.match(/`([^`]+)`/)?.[1] ?? null
  if (result.exitCode === 0 && account) return { state: 'connected', account, detail: null }
  return { state: 'not_connected', account: null, detail: null }
}

type McpServerEntry = { name?: unknown; enabled?: unknown; auth_status?: unknown; transport?: { url?: unknown } }

export function interpretFigmaMcp(result: CommandResult): AuthProbe {
  if (result.timedOut || result.exitCode !== 0) return unreadable(result)
  let entries: McpServerEntry[]
  try {
    const parsed: unknown = JSON.parse(stripAnsi(result.output))
    if (!Array.isArray(parsed)) return unreadable(result)
    entries = parsed as McpServerEntry[]
  } catch {
    return unreadable(result)
  }
  const entry = entries.find((item) => item.name === FIGMA_MCP_NAME)
  if (!entry) return { state: 'not_connected', account: null, detail: 'mcp_not_configured' }
  const serverUrl = typeof entry.transport?.url === 'string' ? entry.transport.url : null
  if (entry.enabled === false) return { state: 'not_connected', account: serverUrl, detail: 'mcp_disabled' }
  const authStatus = typeof entry.auth_status === 'string' ? entry.auth_status : ''
  if (CONNECTED_MCP_AUTH.has(authStatus)) return { state: 'connected', account: serverUrl, detail: null }
  if (authStatus === 'unsupported') return { state: 'connected', account: serverUrl, detail: 'mcp_no_auth_required' }
  return { state: 'not_connected', account: serverUrl, detail: null }
}

export type ToolConnectionsDeps = {
  run?: CommandRunner
  spawnLogin?: LoginSpawner
  now?: () => Date
  host?: string
}

export function createToolConnections(deps: ToolConnectionsDeps = {}) {
  const run = deps.run ?? defaultCommandRunner
  const spawnLogin = deps.spawnLogin ?? defaultLoginSpawner
  const now = deps.now ?? (() => new Date())
  const host = deps.host ?? hostname()
  const state = registry()

  async function probeAuth(toolId: ToolId): Promise<AuthProbe> {
    const bin = TOOL_BINARIES[toolId]
    switch (toolId) {
      case 'codex':
        return interpretCodexLogin(await run(bin, ['login', 'status']))
      case 'claude':
        return interpretClaudeAuth(await run(bin, ['auth', 'status', '--json']))
      case 'wordpress_studio':
        return interpretStudioAuth(await run(bin, ['auth', 'status']))
      case 'figma_mcp':
        return interpretFigmaMcp(await run(bin, ['mcp', 'list', '--json']))
    }
  }

  async function status(toolId: ToolId): Promise<ToolConnectionStatus> {
    const base = {
      id: toolId,
      host,
      lastCheckedAt: now().toISOString(),
      lastLogin: state.lastLogin.get(toolId) ?? null,
    }
    const versionResult = await run(TOOL_BINARIES[toolId], ['--version'])
    if (versionResult.notFound) {
      return {
        ...base,
        installed: false,
        version: null,
        state: 'not_installed',
        account: null,
        detail: toolId === 'figma_mcp' ? 'requires_codex' : null,
        loginUrl: null,
      }
    }
    const version = parseVersion(versionResult.output)
    const pending = state.pending.get(toolId)
    if (pending) {
      return { ...base, installed: true, version, state: 'pending_login', account: null, detail: null, loginUrl: pending.loginUrl }
    }
    const probe = await probeAuth(toolId)
    return { ...base, installed: true, version, ...probe, loginUrl: null }
  }

  async function list(): Promise<ToolConnectionStatus[]> {
    return Promise.all(TOOL_IDS.map((toolId) => status(toolId)))
  }

  function finishLogin(toolId: ToolId, outcome: LoginOutcome) {
    const pending = state.pending.get(toolId)
    if (!pending) return
    clearTimeout(pending.timer)
    state.pending.delete(toolId)
    state.lastLogin.set(toolId, { outcome, finishedAt: now().toISOString() })
  }

  async function ensureFigmaMcpConfigured(): Promise<boolean> {
    const current = interpretFigmaMcp(await run('codex', ['mcp', 'list', '--json']))
    if (current.detail !== 'mcp_not_configured') return current.state !== 'error'
    const added = await run('codex', ['mcp', 'add', FIGMA_MCP_NAME, '--url', figmaMcpUrl()])
    return added.exitCode === 0
  }

  async function connect(toolId: ToolId): Promise<ToolConnectionStatus> {
    if (state.pending.has(toolId)) return status(toolId)
    const current = await status(toolId)
    if (current.state === 'not_installed' || current.state === 'connected') return current
    if (toolId === 'figma_mcp' && !(await ensureFigmaMcpConfigured())) {
      state.lastLogin.set(toolId, { outcome: 'failed', finishedAt: now().toISOString() })
      return status(toolId)
    }
    const loginProcess = spawnLogin(TOOL_BINARIES[toolId], LOGIN_ARGS[toolId])
    const pending: PendingLogin = {
      process: loginProcess,
      output: '',
      loginUrl: null,
      timer: setTimeout(() => {
        loginProcess.kill()
        finishLogin(toolId, 'timeout')
      }, LOGIN_TIMEOUT_MS),
    }
    state.pending.set(toolId, pending)
    loginProcess.onOutput((chunk) => {
      pending.output = (pending.output + chunk).slice(-16_000)
      pending.loginUrl ??= extractLoginUrl(pending.output)
    })
    loginProcess.onExit((exitCode) => {
      if (state.pending.get(toolId) !== pending) return
      finishLogin(toolId, exitCode === 0 ? 'success' : 'failed')
    })
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    return status(toolId)
  }

  async function cancel(toolId: ToolId): Promise<ToolConnectionStatus> {
    const pending = state.pending.get(toolId)
    if (pending) {
      finishLogin(toolId, 'cancelled')
      pending.process.kill()
    }
    return status(toolId)
  }

  async function disconnect(toolId: ToolId): Promise<ToolConnectionStatus> {
    await cancel(toolId)
    const current = await status(toolId)
    if (current.state === 'not_installed') return current
    await run(TOOL_BINARIES[toolId], LOGOUT_ARGS[toolId])
    return status(toolId)
  }

  async function perform(toolId: ToolId, action: ToolAction): Promise<ToolConnectionStatus> {
    switch (action) {
      case 'check':
        return status(toolId)
      case 'connect':
        return connect(toolId)
      case 'cancel':
        return cancel(toolId)
      case 'disconnect':
        return disconnect(toolId)
    }
  }

  return { host, list, status, perform }
}
