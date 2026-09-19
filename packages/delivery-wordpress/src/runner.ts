import { execFile } from 'node:child_process'

export type CommandRunner = (
  executable: 'studio' | 'git',
  args: readonly string[],
  options?: { cwd?: string; timeoutMs?: number },
) => Promise<{ stdout: string; exitCode: 0 }>

function failure(code: string): Error & { code: string } {
  return Object.assign(new Error(`[internal] ${code}`), { code })
}

function bounded(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw failure('INVALID_RUNNER_LIMIT')
  return value
}

export function createCommandRunner(config: { timeoutMs?: number; maxBufferBytes?: number } = {}): CommandRunner {
  const timeoutMs = bounded(config.timeoutMs, 180_000, 600_000)
  const maxBuffer = bounded(config.maxBufferBytes, 1_048_576, 4_194_304)
  return (executable, args, options = {}) => {
    if (!['studio', 'git'].includes(executable) || !Array.isArray(args) || args.some((value) => typeof value !== 'string' || value.includes('\0'))) {
      return Promise.reject(failure('INVALID_COMMAND'))
    }
    const effectiveTimeout = bounded(options.timeoutMs, timeoutMs, timeoutMs)
    return new Promise((resolve, reject) => {
      try {
        execFile(executable, [...args], {
          cwd: options.cwd,
          timeout: effectiveTimeout,
          maxBuffer,
          encoding: 'utf8',
          shell: false,
          killSignal: 'SIGKILL',
          windowsHide: true,
        }, (error, stdout) => {
          if (error) {
            const code = error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
              ? 'COMMAND_OUTPUT_LIMIT'
              : error.killed ? 'COMMAND_INTERRUPTED' : 'COMMAND_FAILED'
            reject(failure(code))
            return
          }
          resolve({ stdout, exitCode: 0 })
        })
      } catch {
        reject(failure('COMMAND_FAILED'))
      }
    })
  }
}

export function parseStudioJson(output: string): unknown {
  if (typeof output !== 'string' || Buffer.byteLength(output, 'utf8') > 4_194_304) throw failure('INVALID_STUDIO_JSON')
  const lines = output.trim().split('\n')
  let candidates = 0
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trimStart() ?? ''
    if (!line.startsWith('{') && !line.startsWith('[')) continue
    candidates += 1
    if (candidates > 32) throw failure('INVALID_STUDIO_JSON')
    try {
      const parsed: unknown = JSON.parse(lines.slice(index).join('\n'))
      if (parsed !== null && typeof parsed === 'object') return parsed
    } catch {
      continue
    }
  }
  throw failure('INVALID_STUDIO_JSON')
}
