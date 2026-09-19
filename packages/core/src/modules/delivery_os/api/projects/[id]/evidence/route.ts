import type { DeliveryOsEvidenceQueries } from '../../../../commands/evidenceQueries'
import { evidenceListQuerySchema, evidenceListResponseSchema } from '../../../../lib/evidenceReadContracts'
import { parseDeliveryInput } from '../../../../commands/shared'
import { requireDeliveryFeatures } from '../../../routeSupport'
import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import type { EvidenceRecordCommandResult } from '@open-mercato/core/modules/delivery_os/commands/evidence'
import {
  DELIVERY_PROJECT_RESOURCE_KIND,
  deliveryHttpError,
  requireScopedProject,
  resolveDeliveryScope,
} from '@open-mercato/core/modules/delivery_os/commands/shared'
import { parseRecordEvidenceBody, recordEvidenceSchema } from '@open-mercato/core/modules/delivery_os/data/validators'
import { uuidSchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { DELIVERY_OS_OPENAPI_TAG } from '@open-mercato/core/modules/delivery_os/api/openapi'
import {
  deliveryErrorResponse,
  executeDeliveryCommand,
  readCappedRouteBody,
  readRouteId,
  resolveDeliveryRouteContext,
  resolveRouteEm,
  type DeliveryRouteContext,
} from '@open-mercato/core/modules/delivery_os/api/routeSupport'
import { deliveryErrorBodySchema, evidenceRecordResponseSchema } from '@open-mercato/core/modules/delivery_os/api/schemas'

const MAX_EVIDENCE_BODY_BYTES = 8_000_000

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['delivery_os.projects.view'] },
  POST: { requireAuth: true, requireFeatures: ['delivery_os.results.import'] },
}

export async function GET(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    await requireDeliveryFeatures(ctx, scope, ['delivery_os.projects.view'])
    const projectId = await readRouteId(context)
    const query = parseDeliveryInput(evidenceListQuerySchema, Object.fromEntries(new URL(request.url).searchParams))
    const queries = ctx.container.resolve('deliveryOsEvidenceQueries') as DeliveryOsEvidenceQueries
    return NextResponse.json(await queries.list(scope, projectId, query), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return deliveryErrorResponse(error, 'delivery_os.evidence.list') }
}

export async function POST(request: Request, context: DeliveryRouteContext): Promise<Response> {
  try {
    const ctx = await resolveDeliveryRouteContext(request)
    const scope = resolveDeliveryScope(ctx)
    const projectId = await readRouteId(context)
    await requireScopedProject(resolveRouteEm(ctx), projectId, scope)
    const parsed = parseRecordEvidenceBody(await readCappedRouteBody(request, MAX_EVIDENCE_BODY_BYTES))
    if (!parsed.ok) throw deliveryHttpError(parsed)
    const outcome = await executeDeliveryCommand<EvidenceRecordCommandResult>(ctx, scope, {
      commandId: 'delivery_os.evidence.record',
      body: { ...parsed.data },
      pathInput: { projectId },
      resourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      resourceId: projectId,
      operation: 'custom',
    })
    if (outcome.blocked) return outcome.blocked
    const { evidenceId, duplicate, taskStatus, taskStatusReason, taskUpdatedAt } = outcome.result
    const body =
      taskStatus && taskUpdatedAt
        ? { evidenceId, duplicate, taskStatus, taskStatusReason: taskStatusReason ?? null, taskUpdatedAt }
        : { evidenceId, duplicate }
    return NextResponse.json(body, { status: duplicate ? 200 : 201 })
  } catch (error) {
    return deliveryErrorResponse(error, 'delivery_os.evidence.record')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: DELIVERY_OS_OPENAPI_TAG,
  summary: 'Project evidence',
  pathParams: z.object({ id: uuidSchema }),
  methods: {
    GET: {
      summary: 'List scoped evidence for one exact revision or the separate revisionless baseline group',
      description: 'Read-only, ordered by createdAt then id. limit <=100, nextOffset null means complete. Missing or foreign project/baseline returns 404; malformed filter returns 400/422. Payload and attachments are loaded only by the detail operation.',
      query: evidenceListQuerySchema,
      responses: [{ status: 200, description: 'Evidence read v1 page', schema: evidenceListResponseSchema }],
      errors: [{ status: 403, description: 'Missing view feature', schema: deliveryErrorBodySchema }, { status: 404, description: 'Not found in scope', schema: deliveryErrorBodySchema }],
    },
    POST: {
      summary: 'Record test, review, screenshot, scan, deployment or reference evidence',
      description:
        'Append-only and discriminated by `kind`. The system checks the proof against the named baseline and the target profile: test checks must use the frozen AC-to-test map, a screenshot must match the stored file, a scan may not name a non-scan profile check, a deployment needs url, environment, buildId and the deployed revision and is stored `unverified` until a verification of the same build is included (`payload.verificationStatus` is derived by the system), and `reference_material` is permitted only by profiles that list it and never counts as acceptance evidence. Idempotent by the canonical hash of the body per project, kind, task and attempt: an identical replay answers 200 with `duplicate: true` and writes nothing (a review is a replay only while it is still the newest review or result of its task). A `review` needs `taskId` and the revision of the accepted result and is the only kind that moves a task, answered with `taskStatus` and `taskUpdatedAt`: `changes_requested` moves `awaiting_review` to `changes_requested`, or to `blocked` with reason `correction_limit_reached` once `limits.maxCorrectionRounds` rounds were requested; `approved` moves `awaiting_review` to `verified` only when every acceptance criterion of the task is proven on the result revision (all required tests passed in the accepted manifest or test evidence, manual checks approved by a human review with `manualCheckId`), else 422 `missing_required_tests`. A review with `manualCheckId` records the human verdict for a manual check and moves nothing. An agent may review, but a manual check needs a signed-in human. The endpoint never publishes.',
      requestBody: { contentType: 'application/json', schema: recordEvidenceSchema },
      responses: [
        { status: 201, description: 'Evidence recorded', schema: evidenceRecordResponseSchema },
        { status: 200, description: 'Identical replay', schema: evidenceRecordResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation failed', schema: deliveryErrorBodySchema },
        { status: 403, description: 'A human review without a signed-in user', schema: deliveryErrorBodySchema },
        { status: 404, description: 'Project or attempt not found in this scope', schema: deliveryErrorBodySchema },
        {
          status: 409,
          description: 'The attempt list of the task is unreadable, or the task is not awaiting review',
          schema: deliveryErrorBodySchema,
        },
        { status: 413, description: 'Body above the size limit', schema: deliveryErrorBodySchema },
        {
          status: 422,
          description:
            'Unsupported kind, foreign baseline, task, file or evidence, baseline mismatch, unknown AC, test or manual check, false hash, unproven acceptance criteria, incomplete deployment or wrong revision kind',
          schema: deliveryErrorBodySchema,
        },
      ],
    },
  },
}
