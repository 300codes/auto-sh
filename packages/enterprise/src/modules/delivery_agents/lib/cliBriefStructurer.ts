import {
  BRIEF_STRUCTURING_SYSTEM_PROMPT,
  buildBriefStructuringPrompt,
  readJsonObject,
  type BriefStructuringRequest,
  type DeliveryBriefStructurer,
} from '@open-mercato/core/modules/delivery_os/lib/briefStructuring'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { defaultCommandRunner, type CommandRunner } from './toolConnections'

const logger = createLogger('delivery_agents').child({ component: 'cli-brief-structurer' })

const STRUCTURING_TIMEOUT_MS = 180_000
const CLI_TOOLS = ['claude', 'codex'] as const
export type BriefCliTool = (typeof CLI_TOOLS)[number]

const JSON_CONTRACT = [
  'Answer with one JSON object and nothing else. No prose, no code fence.',
  'Shape: {"businessGoal":string|null,"audience":string|null,"problem":string|null,"content":string|null,',
  '"features":string[],"integrations":string[],"constraints":string[],"unknowns":string[]}',
  'Each string entry is at most 300 characters; the four text fields are at most 8000 characters.',
].join(' ')

function promptFor(request: BriefStructuringRequest): string {
  return [BRIEF_STRUCTURING_SYSTEM_PROMPT, JSON_CONTRACT, buildBriefStructuringPrompt(request.brief, request.targetProfileId)].join('\n\n')
}

function argsFor(tool: BriefCliTool, prompt: string): string[] {
  return tool === 'claude'
    ? ['--print', '--output-format', 'text', prompt]
    : ['exec', '--skip-git-repo-check', prompt]
}

/** `claude --print` answers with the text itself; `codex exec` frames it in its own run log. */
function readAnswer(tool: BriefCliTool, output: string): unknown | null {
  return readJsonObject(tool === 'claude' ? output : output.split('codex\n').at(-1) ?? output)
}

export type CliBriefStructurerDeps = {
  run?: CommandRunner
  tools?: readonly BriefCliTool[]
  timeoutMs?: number
}

function preferredTools(deps: CliBriefStructurerDeps): readonly BriefCliTool[] {
  if (deps.tools) return deps.tools
  const configured = process.env.DELIVERY_BRIEF_CLI?.trim().toLowerCase()
  const preferred = CLI_TOOLS.find((tool) => tool === configured)
  return preferred ? [preferred] : CLI_TOOLS
}

/**
 * Structures a brief with the agent CLI the operator already connected in Settings → Tool connections, so the wizard
 * runs on their existing subscription instead of an API key. Every tool that is missing, unauthenticated or answers
 * without a JSON object is skipped; returning null lets the caller fall back to a configured API model.
 */
export function createCliBriefStructurer(deps: CliBriefStructurerDeps = {}): DeliveryBriefStructurer {
  const run = deps.run ?? defaultCommandRunner
  const timeoutMs = deps.timeoutMs ?? STRUCTURING_TIMEOUT_MS
  return {
    async structure(request: BriefStructuringRequest): Promise<unknown | null> {
      const prompt = promptFor(request)
      for (const tool of preferredTools(deps)) {
        const result = await run(tool, argsFor(tool, prompt), timeoutMs)
        if (result.notFound) continue
        if (result.timedOut || result.exitCode !== 0) {
          logger.info('agent CLI did not structure the brief', { tool, exitCode: result.exitCode, timedOut: result.timedOut })
          continue
        }
        const answer = readAnswer(tool, result.output)
        if (answer) return answer
        logger.info('agent CLI answered without a JSON object', { tool })
      }
      return null
    },
  }
}
