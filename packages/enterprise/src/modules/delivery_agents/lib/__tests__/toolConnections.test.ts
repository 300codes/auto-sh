import {
  createToolConnections,
  extractLoginUrl,
  interpretClaudeAuth,
  interpretCodexLogin,
  interpretFigmaMcp,
  interpretStudioAuth,
  parseVersion,
  type CommandResult,
  type CommandRunner,
  type LoginSpawner,
} from '../toolConnections'

function ok(output: string): CommandResult {
  return { exitCode: 0, output, notFound: false, timedOut: false }
}

function failed(output = ''): CommandResult {
  return { exitCode: 1, output, notFound: false, timedOut: false }
}

const NOT_FOUND: CommandResult = { exitCode: null, output: '', notFound: true, timedOut: false }

function mcpList(entries: unknown[]): CommandResult {
  return ok(JSON.stringify(entries))
}

function fakeLogin() {
  const exitListeners: Array<(code: number | null) => void> = []
  const outputListeners: Array<(chunk: string) => void> = []
  const calls: Array<{ bin: string; args: readonly string[] }> = []
  let killed = 0
  const spawner: LoginSpawner = (bin, args) => {
    calls.push({ bin, args })
    return {
      kill: () => {
        killed += 1
      },
      onExit: (listener) => exitListeners.push(listener),
      onOutput: (listener) => outputListeners.push(listener),
    }
  }
  return {
    spawner,
    calls,
    killed: () => killed,
    emit: (chunk: string) => outputListeners.forEach((listener) => listener(chunk)),
    exit: (code: number | null) => exitListeners.forEach((listener) => listener(code)),
  }
}

function clearRegistry() {
  const holder = globalThis as Record<symbol, unknown>
  delete holder[Symbol.for('open-mercato.delivery_agents.toolConnections')]
}

describe('tool connection parsing', () => {
  it('takes the running version even when an update banner precedes it', () => {
    expect(parseVersion('Update available: 1.19.0 → 1.21.0\n1.19.0\n')).toBe('1.19.0')
    expect(parseVersion('codex-cli 0.150.1')).toBe('0.150.1')
    expect(parseVersion('no version here')).toBeNull()
  })

  it('reads the codex login state', () => {
    expect(interpretCodexLogin(ok('Logged in using ChatGPT\n'))).toEqual({ state: 'connected', account: 'ChatGPT', detail: null })
    expect(interpretCodexLogin(failed('Not logged in'))).toMatchObject({ state: 'not_connected' })
    expect(interpretCodexLogin(failed('Your refresh token has expired'))).toMatchObject({ state: 'expired' })
  })

  it('reads claude auth json', () => {
    expect(interpretClaudeAuth(ok('{"loggedIn":true,"email":"dev@example.com"}'))).toMatchObject({
      state: 'connected',
      account: 'dev@example.com',
    })
    expect(interpretClaudeAuth(failed('{"loggedIn":false}'))).toMatchObject({ state: 'not_connected' })
    expect(interpretClaudeAuth(ok('garbage'))).toMatchObject({ state: 'error', detail: 'status_unreadable' })
  })

  it('treats an installed studio without an account as not connected', () => {
    expect(interpretStudioAuth(ok('\u001b[K✔ Uwierzytelniony serwisem WordPress.com jako `300codes`'))).toMatchObject({
      state: 'connected',
      account: '300codes',
    })
    expect(interpretStudioAuth(failed('Nie jesteś uwierzytelniony'))).toMatchObject({ state: 'not_connected' })
  })

  it('separates a missing figma server, a missing login and a logged in server', () => {
    expect(interpretFigmaMcp(mcpList([{ name: 'node_repl', enabled: true }]))).toMatchObject({
      state: 'not_connected',
      detail: 'mcp_not_configured',
    })
    const transport = { url: 'https://mcp.figma.com/mcp' }
    expect(interpretFigmaMcp(mcpList([{ name: 'figma', enabled: true, auth_status: 'not_logged_in', transport }]))).toMatchObject({
      state: 'not_connected',
      detail: null,
    })
    expect(interpretFigmaMcp(mcpList([{ name: 'figma', enabled: true, auth_status: 'o_auth', transport }]))).toEqual({
      state: 'connected',
      account: 'https://mcp.figma.com/mcp',
      detail: null,
    })
    expect(interpretFigmaMcp(failed())).toMatchObject({ state: 'error' })
  })

  it('extracts the first login url from cli output', () => {
    expect(extractLoginUrl('Open \u001b[1mhttps://auth.example.com/authorize?x=1\u001b[0m in a browser.')).toBe(
      'https://auth.example.com/authorize?x=1',
    )
    expect(extractLoginUrl('nothing')).toBeNull()
  })
})

describe('createToolConnections', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    clearRegistry()
  })

  afterEach(() => {
    jest.useRealTimers()
    clearRegistry()
  })

  async function flush<T>(promise: Promise<T>): Promise<T> {
    await jest.advanceTimersByTimeAsync(2_000)
    return promise
  }

  it('reports a missing program as not installed without probing login', async () => {
    const run: jest.MockedFunction<CommandRunner> = jest.fn(async () => NOT_FOUND)
    const connections = createToolConnections({ run, host: 'station' })
    const status = await connections.status('codex')
    expect(status).toMatchObject({ installed: false, state: 'not_installed', host: 'station' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('runs one login per tool, exposes the login url and records success', async () => {
    let loggedIn = false
    const run: CommandRunner = async (_bin, args) => {
      if (args[0] === '--version') return ok('codex-cli 0.150.1')
      return loggedIn ? ok('Logged in using ChatGPT') : failed('Not logged in')
    }
    const login = fakeLogin()
    const connections = createToolConnections({ run, spawnLogin: login.spawner, host: 'station' })

    const started = connections.perform('codex', 'connect')
    await jest.advanceTimersByTimeAsync(100)
    login.emit('Starting local login server. Visit https://auth.openai.com/oauth/authorize?state=abc to continue')
    const pending = await flush(started)
    expect(pending).toMatchObject({ state: 'pending_login', loginUrl: 'https://auth.openai.com/oauth/authorize?state=abc' })

    const again = await flush(connections.perform('codex', 'connect'))
    expect(again.state).toBe('pending_login')
    expect(login.calls).toHaveLength(1)
    expect(login.calls[0]).toEqual({ bin: 'codex', args: ['login'] })

    loggedIn = true
    login.exit(0)
    const done = await connections.status('codex')
    expect(done).toMatchObject({ state: 'connected', account: 'ChatGPT', lastLogin: { outcome: 'success' } })
  })

  it('cancels a pending login and kills the process', async () => {
    const run: CommandRunner = async (_bin, args) => (args[0] === '--version' ? ok('2.1.0') : failed('{"loggedIn":false}'))
    const login = fakeLogin()
    const connections = createToolConnections({ run, spawnLogin: login.spawner })
    await flush(connections.perform('claude', 'connect'))
    const cancelled = await connections.perform('claude', 'cancel')
    expect(login.killed()).toBe(1)
    expect(cancelled).toMatchObject({ state: 'not_connected', lastLogin: { outcome: 'cancelled' } })
  })

  it('adds the figma server to codex before starting the figma login', async () => {
    const calls: string[] = []
    let configured = false
    const run: CommandRunner = async (_bin, args) => {
      calls.push(args.join(' '))
      if (args[0] === '--version') return ok('codex-cli 0.150.1')
      if (args[0] === 'mcp' && args[1] === 'add') {
        configured = true
        return ok('')
      }
      return mcpList(configured ? [{ name: 'figma', enabled: true, auth_status: 'not_logged_in', transport: {} }] : [])
    }
    const login = fakeLogin()
    const connections = createToolConnections({ run, spawnLogin: login.spawner })
    const status = await flush(connections.perform('figma_mcp', 'connect'))
    expect(calls).toContain('mcp add figma --url https://mcp.figma.com/mcp')
    expect(login.calls[0]).toEqual({ bin: 'codex', args: ['mcp', 'login', 'figma'] })
    expect(status.state).toBe('pending_login')
  })

  it('does not start a login for a tool that is already connected', async () => {
    const run: CommandRunner = async (_bin, args) => (args[0] === '--version' ? ok('1.19.0') : ok('jako `site`'))
    const login = fakeLogin()
    const connections = createToolConnections({ run, spawnLogin: login.spawner })
    const status = await connections.perform('wordpress_studio', 'connect')
    expect(status.state).toBe('connected')
    expect(login.calls).toHaveLength(0)
  })
})
