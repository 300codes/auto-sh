import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveDeliveryScope } from '@open-mercato/core/modules/delivery_os/commands/shared'
import { commentImportBatchV1Schema, type CommentThread, type FlowStageId } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { hashCanonical } from '@open-mercato/core/modules/delivery_os/lib/hash'
import type { createCredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { createIntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { createFigmaCommentsClient, figmaCredentialsSchema } from './client'
import { normalizeFigmaComments } from './normalize'

export type FigmaSyncInput = { projectId: string; fileKey: string; stageId: FlowStageId; artifactId: string | null }
type CommentQueries = {
  syncSnapshot(ctx: CommandRuntimeContext, input: FigmaSyncInput): Promise<{ threads: CommentThread[]; cursor: string | null }>
}

export function createDeliveryFigmaProvider(client = createFigmaCommentsClient()) {
  return {
    async prepare(ctx: CommandRuntimeContext, input: FigmaSyncInput) {
      const scope = resolveDeliveryScope(ctx)
      const queries = ctx.container.resolve('deliveryOsCommentQueries') as CommentQueries
      const previous = await queries.syncSnapshot(ctx, input)
      const states = ctx.container.resolve('integrationStateService') as ReturnType<typeof createIntegrationStateService>
      if (!(await states.isEnabled('delivery_figma', scope))) {
        throw new CrudHttpError(422, { code: 'figma_unconfigured', error: '[internal] Figma integration is disabled' })
      }
      const credentials = ctx.container.resolve('integrationCredentialsService') as ReturnType<typeof createCredentialsService>
      const secret = figmaCredentialsSchema.safeParse(await credentials.resolve('delivery_figma', scope))
      if (!secret.success) throw new CrudHttpError(422, { code: 'figma_unconfigured', error: '[internal] Figma credentials are unavailable' })
      const comments = await client.read(input.fileKey, secret.data)
      const fetchedAt = new Date().toISOString()
      const threads = normalizeFigmaComments(input.fileKey, comments, previous.threads, fetchedAt)
      const snapshotHash = hashCanonical(threads)
      const batches = []
      let after = previous.cursor
      for (let offset = 0; offset < Math.max(threads.length, 1); offset += 200) {
        const next = `figma:${snapshotHash}:${Math.min(offset + 200, threads.length)}`
        const batch = commentImportBatchV1Schema.parse({
          schemaVersion: 'delivery.comment-import/v1', ...input, source: 'figma', fetchedAt,
          cursor: { after, next }, threads: threads.slice(offset, offset + 200),
        })
        batches.push({ batch, idempotencyKey: `figma:${hashCanonical(batch)}` })
        after = next
      }
      return batches
    },
  }
}
