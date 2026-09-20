import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { createAttachmentFromBuffer } from '@open-mercato/core/modules/attachments/lib/createFromBuffer'
import { designScreenSchema, type DesignScreen } from './contracts'
import { renderFileName, type FigmaDesignResult } from './designAgent'

const logger = createLogger('delivery_os').child({ component: 'stage-renders' })

const MAX_RENDER_BYTES = 10 * 1024 * 1024
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** The directory the design agent writes its renders to; the agent sandbox allows the system temp folder. */
export function stageRenderDir(projectId: string, stageId: string): string {
  return join(tmpdir(), 'delivery-figma-renders', projectId, stageId)
}

type StoreInput = {
  em: EntityManager
  dataEngine?: Parameters<typeof createAttachmentFromBuffer>[0]['dataEngine']
  design: FigmaDesignResult
  projectId: string
  stageId: string
  scope: { tenantId: string; organizationId: string }
  /** Overrides where the renders are read from; the route lets it default to the agent's directory. */
  renderDir?: string
}

/**
 * Stores the render the agent downloaded for each frame and turns it into a stage screen. The bytes are hashed here,
 * so the frozen baseline can read them back and get the same sha256. A frame whose render is missing or unreadable is
 * skipped rather than faked: it keeps its Figma reference and simply claims no screen.
 */
export async function storeStageRenders(input: StoreInput): Promise<DesignScreen[]> {
  const directory = input.renderDir ?? stageRenderDir(input.projectId, input.stageId)
  const screens: DesignScreen[] = []
  for (const node of input.design.nodes) {
    const path = join(directory, renderFileName(node.nodeId))
    let buffer: Buffer
    try {
      buffer = await readFile(path)
    } catch {
      logger.info('the agent reported a frame without a render, so the stage claims no screen for it', { stageId: input.stageId, nodeId: node.nodeId })
      continue
    }
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_RENDER_BYTES || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
      logger.info('a render was not a usable PNG, so the stage claims no screen for it', { stageId: input.stageId, nodeId: node.nodeId, sizeBytes: buffer.byteLength })
      continue
    }
    const attachment = await createAttachmentFromBuffer({
      em: input.em,
      dataEngine: input.dataEngine,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      entityId: 'delivery_os:project',
      recordId: input.projectId,
      fileName: renderFileName(node.nodeId),
      mimeType: 'image/png',
      buffer,
    })
    const screen = designScreenSchema.safeParse({
      fileKey: input.design.fileKey,
      nodeId: node.nodeId,
      name: node.name,
      viewport: { width: node.width, height: node.height },
      attachmentId: attachment.id,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      capturedAt: new Date().toISOString(),
      sizeBytes: buffer.byteLength,
      mimeType: 'image/png',
    })
    if (!screen.success) {
      logger.warn('a stored render did not fit the screen contract', { stageId: input.stageId, nodeId: node.nodeId })
      continue
    }
    screens.push(screen.data)
  }
  return screens
}
