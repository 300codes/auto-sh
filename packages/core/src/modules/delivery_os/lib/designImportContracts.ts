import { z } from 'zod'
import { designManifestV1Schema, designScreenSchema, isoDateTimeSchema, sha256Schema, uuidSchema, type DesignScreen } from './contracts'

export const DESIGN_IMPORT_SCHEMA_VERSION = 'delivery-design-import.v1' as const
export const designImportManifestSchema = designManifestV1Schema.superRefine((manifest, context) => {
  const identities = new Set<string>()
  manifest.screens.forEach((screen, index) => {
    const key = designImportScreenKey(screen)
    if (identities.has(key)) context.addIssue({ code: 'custom', path: ['screens', index], message: 'Duplicate screen version' })
    identities.add(key)
  })
})
export function designImportScreenIdentity(screen: Pick<DesignScreen, 'fileKey' | 'nodeId' | 'viewport'>): string {
  return JSON.stringify([screen.fileKey, screen.nodeId, screen.viewport.width, screen.viewport.height])
}
export function designImportScreenKey(screen: DesignScreen): string {
  return JSON.stringify([screen.fileKey, screen.nodeId, screen.viewport.width, screen.viewport.height, screen.figmaVersion ?? null])
}
export const designImportProgressSchema = z.object({
  screens: z.array(z.object({ key: z.string().min(1).max(1000), screen: designScreenSchema.nullable(), errorCode: z.string().max(100).nullable() })).max(100),
  selectedKeys: z.array(z.string().min(1).max(1000)).max(100),
})
export const designImportSessionSchema = z.object({
  schemaVersion: z.literal(DESIGN_IMPORT_SCHEMA_VERSION),
  id: uuidSchema,
  projectId: uuidSchema,
  manifestHash: sha256Schema,
  manifest: designImportManifestSchema,
  progress: designImportProgressSchema,
  status: z.enum(['partial', 'complete', 'cancelled']),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})
export const designImportListSchema = z.object({ schemaVersion: z.literal(DESIGN_IMPORT_SCHEMA_VERSION), items: z.array(designImportSessionSchema).max(100) })
export type DesignImportSession = z.infer<typeof designImportSessionSchema>
