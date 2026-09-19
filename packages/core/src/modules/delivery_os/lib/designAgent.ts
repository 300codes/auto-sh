import { z } from 'zod'

export const DELIVERY_DESIGN_AGENT_KEY = 'deliveryDesignAgent'

/** What the design agent is asked to build in Figma, and what it must report back about the real nodes it created. */
export const figmaDesignResultSchema = z.object({
  fileKey: z.string().trim().regex(/^[A-Za-z0-9_-]{10,200}$/),
  fileUrl: z.url().max(2000),
  summary: z.string().trim().min(1).max(8000),
  notes: z.string().trim().min(1).max(8000),
  nodes: z.array(z.object({
    nodeId: z.string().trim().regex(/^[0-9]+:[0-9]+$/),
    name: z.string().trim().min(1).max(300),
    width: z.number().int().positive().max(20000),
    height: z.number().int().positive().max(20000),
  })).min(1).max(100),
})
export type FigmaDesignResult = z.infer<typeof figmaDesignResultSchema>

export type DesignAgentRequest = {
  stageId: 'ux' | 'key_visual' | 'design_system_ui'
  projectName: string
  targetProfileId: string
  /** The Figma file earlier stages already created; null asks the agent to create one for this project. */
  fileKey: string | null
  brief: string
  instructions: string
}

/**
 * Optional peer that produces the stage design **inside Figma** through the operator's connected agent CLI and its
 * Figma MCP server. Returning null means "not available here", so the caller can say so instead of inventing a design.
 */
export type DeliveryDesignAgent = {
  design(request: DesignAgentRequest): Promise<unknown | null>
}

export function tryResolveDesignAgent(container: { resolve: (name: string) => unknown }): DeliveryDesignAgent | null {
  try {
    const service = container.resolve(DELIVERY_DESIGN_AGENT_KEY) as DeliveryDesignAgent | null
    return service && typeof service.design === 'function' ? service : null
  } catch {
    return null
  }
}
