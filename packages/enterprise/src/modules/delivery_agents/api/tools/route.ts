import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  deliveryErrorResponse,
  resolveDeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import { TOOL_ACTIONS, TOOL_IDS, createToolConnections } from '../../lib/toolConnections'

const logger = createLogger('delivery_agents').child({ route: 'tools' })

export const metadata = {
  GET: {
    requireAuth: true,
    requireFeatures: ['delivery_agents.tools.view'],
  },
  POST: {
    requireAuth: true,
    requireFeatures: ['delivery_agents.tools.manage'],
  },
}

const listQuerySchema = z.object({
  toolId: z.enum(TOOL_IDS).optional(),
})

const actionBodySchema = z.object({
  toolId: z.enum(TOOL_IDS),
  action: z.enum(TOOL_ACTIONS),
})

const toolStatusSchema = z.object({
  id: z.enum(TOOL_IDS),
  host: z.string(),
  installed: z.boolean(),
  version: z.string().nullable(),
  state: z.enum(['not_installed', 'not_connected', 'pending_login', 'connected', 'expired', 'error']),
  account: z.string().nullable(),
  detail: z.string().nullable(),
  loginUrl: z.string().nullable(),
  lastCheckedAt: z.string(),
  lastLogin: z
    .object({ outcome: z.enum(['success', 'failed', 'cancelled', 'timeout']), finishedAt: z.string() })
    .nullable(),
})

export async function GET(request: Request): Promise<Response> {
  try {
    await resolveDeliveryRouteContext(request)
    const parsed = listQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid query', code: 'validation_failed' }, { status: 400 })
    }
    const connections = createToolConnections()
    const tools = parsed.data.toolId
      ? [await connections.status(parsed.data.toolId)]
      : await connections.list()
    return NextResponse.json({ host: connections.host, tools }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    return deliveryErrorResponse(error, 'delivery_agents.tools.list')
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const routeCtx = await resolveDeliveryRouteContext(request)
    const body = await request.json().catch(() => ({}))
    const parsed = actionBodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', code: 'validation_failed' }, { status: 400 })
    }
    const { toolId, action } = parsed.data
    const connections = createToolConnections()
    logger.info('Tool connection action', {
      toolId,
      action,
      host: connections.host,
      actorId: routeCtx.auth?.sub ?? null,
      tenantId: routeCtx.auth?.tenantId ?? null,
      organizationId: routeCtx.selectedOrganizationId,
    })
    const tool = await connections.perform(toolId, action)
    return NextResponse.json({ tool }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    return deliveryErrorResponse(error, 'delivery_agents.tools.action')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Delivery Agents',
  summary: 'Tool connections on the execution host',
  methods: {
    GET: {
      summary: 'List installation and login status of delivery tools on the execution host',
      query: listQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Tool statuses',
          schema: z.object({ host: z.string(), tools: z.array(toolStatusSchema) }),
        },
      ],
      errors: [
        { status: 400, description: 'Invalid query' },
        { status: 403, description: 'Missing required features' },
      ],
    },
    POST: {
      summary: 'Check, start login, cancel login or disconnect a delivery tool',
      requestBody: { contentType: 'application/json', schema: actionBodySchema },
      responses: [{ status: 200, description: 'Updated tool status', schema: z.object({ tool: toolStatusSchema }) }],
      errors: [
        { status: 400, description: 'Invalid body' },
        { status: 403, description: 'Missing required features' },
      ],
    },
  },
}
