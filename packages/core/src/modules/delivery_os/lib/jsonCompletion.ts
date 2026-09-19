import type { z } from 'zod'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { tryResolveBriefStructurer } from './briefStructuring'

const logger = createLogger('delivery_os').child({ component: 'json-completion' })

type Container = { resolve: <T = unknown>(name: string) => T }

export type DeliveryJsonRequest = { system: string; prompt: string }

async function completeWithModel<T>(container: Container, request: DeliveryJsonRequest, schema: z.ZodType<T>): Promise<unknown> {
  const [{ createModelFactory }, { generateObject }] = await Promise.all([
    import('@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'),
    import('@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-sdk'),
  ])
  const resolution = createModelFactory(container as never).resolveModel({ moduleId: 'delivery_os' })
  type ObjectCall = { model: unknown; schema: unknown; system: string; prompt: string }
  const generated = await generateObject({
    model: resolution.model,
    schema,
    system: request.system,
    prompt: request.prompt,
  } as ObjectCall as Parameters<typeof generateObject>[0])
  return generated.object
}

/**
 * Asks for one JSON object, preferring the agent CLI the operator connected in Settings → Tool connections so the flow
 * runs on their existing subscription, and falling back to a configured API model. `tool` names what answered.
 */
export async function completeDeliveryJson<T>(
  container: Container,
  request: DeliveryJsonRequest,
  schema: z.ZodType<T>,
): Promise<{ value: unknown; tool: string } | null> {
  const structurer = tryResolveBriefStructurer(container)
  logger.info('resolving a JSON completion', { agentCli: Boolean(structurer?.completeJson) })
  if (structurer?.completeJson) {
    const answer = await structurer.completeJson(request)
    if (answer !== null && answer !== undefined) return { value: answer, tool: 'agent-cli' }
    logger.info('the connected agent CLI did not answer; falling back to a configured model')
  }
  try {
    const value = await completeWithModel(container, request, schema)
    return value === null || value === undefined ? null : { value, tool: 'api-model' }
  } catch (error) {
    logger.info('no configured model answered either', { reason: error instanceof Error ? error.message : String(error) })
    return null
  }
}
