jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }),
}))

import { createCliBriefStructurer } from '../cliBriefStructurer'
import type { CommandResult } from '../toolConnections'

const request = { brief: 'Studio site with three services', targetProfileId: 'wordpress-theme' }
const extraction = { businessGoal: 'Sell three services', audience: null, problem: null, content: null, features: ['Contact form'], integrations: [], constraints: [], unknowns: [] }
const ok = (output: string): CommandResult => ({ exitCode: 0, notFound: false, timedOut: false, output })

function runner(results: Record<string, CommandResult>) {
  const calls: Array<{ bin: string; args: readonly string[] }> = []
  const run = jest.fn(async (bin: string, args: readonly string[]) => {
    calls.push({ bin, args })
    return results[bin] ?? { exitCode: null, notFound: true, timedOut: false, output: '' }
  })
  return { run, calls }
}

describe('CLI brief structurer', () => {
  it('drives the connected claude CLI in print mode and returns its JSON answer', async () => {
    const { run, calls } = runner({ claude: ok(`${JSON.stringify(extraction)}\n`) })
    const structurer = createCliBriefStructurer({ run, tools: ['claude', 'codex'] })
    await expect(structurer.structure(request)).resolves.toEqual(extraction)
    expect(calls).toHaveLength(1)
    expect(calls[0].bin).toBe('claude')
    expect(calls[0].args.slice(0, 3)).toEqual(['--print', '--output-format', 'text'])
    expect(calls[0].args.at(-1)).toContain(request.brief)
    expect(calls[0].args.at(-1)).toContain('wordpress-theme')
  })

  it('reads a fenced answer and the tail of a codex run log', async () => {
    const { run } = runner({ codex: ok(`codex\nthinking...\ncodex\n\`\`\`json\n${JSON.stringify(extraction)}\n\`\`\`\n`) })
    const structurer = createCliBriefStructurer({ run, tools: ['codex'] })
    await expect(structurer.structure(request)).resolves.toEqual(extraction)
  })

  it('falls through to the next CLI when one is missing, failing or not answering with JSON', async () => {
    const { run, calls } = runner({
      claude: { exitCode: 1, notFound: false, timedOut: false, output: 'Invalid API key / not logged in' },
      codex: ok(JSON.stringify(extraction)),
    })
    const structurer = createCliBriefStructurer({ run, tools: ['claude', 'codex'] })
    await expect(structurer.structure(request)).resolves.toEqual(extraction)
    expect(calls.map((call) => call.bin)).toEqual(['claude', 'codex'])
  })

  it('returns null when no connected CLI answers, so the caller can fall back', async () => {
    const { run } = runner({ claude: ok('I cannot help with that.') })
    const structurer = createCliBriefStructurer({ run, tools: ['claude', 'codex'] })
    await expect(structurer.structure(request)).resolves.toBeNull()
  })

  it('honours an explicit tool preference', async () => {
    const { run, calls } = runner({ claude: ok(JSON.stringify(extraction)), codex: ok(JSON.stringify(extraction)) })
    const structurer = createCliBriefStructurer({ run, tools: ['codex'] })
    await structurer.structure(request)
    expect(calls.map((call) => call.bin)).toEqual(['codex'])
  })
})
