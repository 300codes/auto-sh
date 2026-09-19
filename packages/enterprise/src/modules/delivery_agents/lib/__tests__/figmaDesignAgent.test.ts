jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }),
}))

import { createFigmaDesignAgent } from '../figmaDesignAgent'
import type { CommandResult } from '../toolConnections'

const request = {
  stageId: 'ux' as const,
  projectName: 'Aster Works',
  targetProfileId: 'wordpress-theme',
  fileKey: null,
  brief: 'Cztery widoki, granat #082C55',
  instructions: 'Work through the figma MCP server.',
}
const design = {
  fileKey: 'ES4noLJGt7u47StnPl5y1a',
  fileUrl: 'https://www.figma.com/design/ES4noLJGt7u47StnPl5y1a',
  summary: 'Cztery widoki',
  notes: 'Nagłówek',
  nodes: [{ nodeId: '1:2', name: 'Strona główna', width: 1440, height: 1024 }],
}
const ok = (output: string): CommandResult => ({ exitCode: 0, notFound: false, timedOut: false, output })

function runner(result: CommandResult) {
  const calls: Array<{ bin: string; args: readonly string[] }> = []
  const run = jest.fn(async (bin: string, args: readonly string[]) => {
    calls.push({ bin, args })
    return result
  })
  return { run, calls }
}

describe('Figma design agent', () => {
  it('drives codex with approvals enabled, because Figma write tools need them', async () => {
    const { run, calls } = runner(ok(`codex\n${JSON.stringify(design)}\n`))
    const agent = createFigmaDesignAgent({ run, plan: '300.codes' })
    await expect(agent.design(request)).resolves.toEqual(design)
    expect(calls[0].bin).toBe('codex')
    expect(calls[0].args.slice(0, 3)).toEqual(['exec', '--skip-git-repo-check', '--approve-for-me'])
  })

  it('names the Figma plan when it creates the project file', async () => {
    const { run, calls } = runner(ok(JSON.stringify(design)))
    await createFigmaDesignAgent({ run, plan: '300.codes' }).design(request)
    expect(calls[0].args.at(-1)).toContain('in the Figma plan "300.codes"')
  })

  it('points a later stage at the file an earlier stage created instead of making a new one', async () => {
    const { run, calls } = runner(ok(JSON.stringify(design)))
    await createFigmaDesignAgent({ run, plan: '300.codes' }).design({ ...request, stageId: 'key_visual', fileKey: design.fileKey })
    expect(calls[0].args.at(-1)).toContain(`Use the existing Figma file ${design.fileKey}`)
    expect(calls[0].args.at(-1)).not.toContain('create one named after the project')
  })

  it.each([
    ['codex is missing', { exitCode: null, notFound: true, timedOut: false, output: '' }],
    ['the run fails', { exitCode: 1, notFound: false, timedOut: false, output: 'not logged in' }],
    ['the run times out', { exitCode: null, notFound: false, timedOut: true, output: '' }],
    ['the answer holds no JSON', ok('I need a Figma plan first.')],
  ])('returns null when %s, so the caller can say so', async (_label, result) => {
    const { run } = runner(result as CommandResult)
    await expect(createFigmaDesignAgent({ run }).design(request)).resolves.toBeNull()
  })
})
