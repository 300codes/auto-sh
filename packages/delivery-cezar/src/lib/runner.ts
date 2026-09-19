import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { redactCliArgsForLogs } from './logRedaction'

export type CezarRunOptions = {
  task: string
  baseDir: string
  extraArgs?: readonly string[]
  timeoutMs?: number
  cezarBin?: string
}

export type CezarRunResult = {
  exitCode: number
  stdout: string
  stderr: string
  runId: string | undefined
  durationMs: number
}

const CEZAR_BIN_DEFAULT = 'npx'
const CEZAR_ARGS_PREFIX = ['cezar-cli', 'run']
const CEZAR_FLAGS = ['--no-open']
const RUNS_JSON_POLL_MS = 1500

// Cezar outputs "run finished" after CEZ:DONE is received — fast path.
const RUN_DONE_PATTERN = /run finished/

// After the step header, task output follows. We track it with:
const STEP_HEADER_PATTERN = /── step:/
// If stdout is quiet for this long after task content arrives, Claude has
// finished its response (with or without CEZ:DONE). 5s is enough padding
// for any remaining flush without introducing false positives mid-task.
const CONTENT_STABLE_DELAY_MS = 5_000

type CezarRunEntry = { id: string; status: string }

async function readRunsJson(baseDir: string): Promise<CezarRunEntry[]> {
  try {
    const raw = await readFile(join(baseDir, '.ai/cezar/runs.json'), 'utf8')
    return JSON.parse(raw) as CezarRunEntry[]
  } catch {
    return []
  }
}

function extractRunId(stdout: string): string | undefined {
  // Cezar prints: "  · worktree ready — branch cez/<8-char-prefix> (base main)"
  const match = stdout.match(/branch cez\/([0-9a-f]+)/i)
  return match?.[1]
}

async function pollForCompletion(
  baseDir: string,
  runIdPrefix: string,
  timeoutMs: number,
): Promise<{ status: string; fullId: string } | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const runs = await readRunsJson(baseDir)
    const entry = runs.find((r) => r.id.startsWith(runIdPrefix))
    if (entry && (entry.status === 'done' || entry.status === 'failed')) {
      return { status: entry.status, fullId: entry.id }
    }
    await new Promise((r) => setTimeout(r, RUNS_JSON_POLL_MS))
  }
  return null
}

export async function runCezarTask(options: CezarRunOptions): Promise<CezarRunResult> {
  const { task, baseDir, extraArgs = [], timeoutMs = 20 * 60 * 1000, cezarBin = CEZAR_BIN_DEFAULT } = options

  const args = [...CEZAR_ARGS_PREFIX, task, ...CEZAR_FLAGS, ...extraArgs]
  const logSafeArgs = redactCliArgsForLogs(args)

  const startMs = Date.now()
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []

  return new Promise((resolve, reject) => {
    const child = spawn(cezarBin, args, {
      cwd: baseDir,
      env: { ...process.env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let settled = false

    function settle(exitCode: number) {
      if (settled) return
      settled = true
      clearTimeout(globalTimer)
      if (contentStableTimer) clearTimeout(contentStableTimer)
      child.kill('SIGTERM')
      const stdout = Buffer.concat(stdoutChunks).toString('utf8')
      const stderr = Buffer.concat(stderrChunks).toString('utf8')
      resolve({ exitCode, stdout, stderr, runId: extractRunId(stdout), durationMs: Date.now() - startMs })
    }

    const globalTimer = setTimeout(() => {
      if (settled) return
      settled = true
      if (contentStableTimer) clearTimeout(contentStableTimer)
      child.kill('SIGTERM')
      reject(new Error(`[internal] Cezar run timed out after ${timeoutMs}ms. Args: ${logSafeArgs.join(' ')}`))
    }, timeoutMs)

    let pollingStarted = false
    let stepSeen = false
    let contentStableTimer: ReturnType<typeof setTimeout> | null = null

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk)
      const accumulated = Buffer.concat(stdoutChunks).toString('utf8')

      // Signal 1: "run finished" — Cezar received CEZ:DONE, run is complete.
      if (RUN_DONE_PATTERN.test(accumulated)) {
        settle(0)
        return
      }

      // Track when step header appears.
      if (!stepSeen && STEP_HEADER_PATTERN.test(accumulated)) {
        stepSeen = true
      }

      // Signal 2 (content stability): After the step starts, any new stdout
      // resets a timer. When the timer fires (5s of silence), Claude's response
      // is complete. This handles tasks where Claude omits CEZ:DONE.
      if (stepSeen) {
        if (contentStableTimer) clearTimeout(contentStableTimer)
        contentStableTimer = setTimeout(() => {
          settle(0)
        }, CONTENT_STABLE_DELAY_MS)
      }

      // Signal 3: Poll runs.json for "done"/"failed" once we have the runId.
      if (!pollingStarted) {
        const runIdPrefix = extractRunId(accumulated)
        if (runIdPrefix) {
          pollingStarted = true
          const remainingMs = timeoutMs - (Date.now() - startMs)
          pollForCompletion(baseDir, runIdPrefix, remainingMs).then((result) => {
            if (result) settle(result.status === 'done' ? 0 : 1)
          })
        }
      }
    })

    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

    child.on('error', (err: Error) => {
      if (settled) return
      settled = true
      clearTimeout(globalTimer)
      if (contentStableTimer) clearTimeout(contentStableTimer)
      reject(new Error(`[internal] Failed to spawn Cezar: ${err.message}`))
    })

    child.on('close', (code: number | null) => settle(code ?? 0))
  })
}
