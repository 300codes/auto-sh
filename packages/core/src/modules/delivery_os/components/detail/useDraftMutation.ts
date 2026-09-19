'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import {
  projectDetailSchema,
  projectUpdateResponseSchema,
} from '@open-mercato/core/modules/delivery_os/api/schemas'
import type { DraftSpecV1 } from '@open-mercato/core/modules/delivery_os/data/validators'
import { readDraftSpec } from './draftSpec'

export type DraftMutation = (draft: DraftSpecV1) => { ok: true; draft: DraftSpecV1 } | { ok: false; reason: string }

export type DraftMutationOutcome =
  | { ok: true; projectUpdatedAt: string; draft: DraftSpecV1 }
  | { ok: false; reason: 'load_failed' | 'unparsable' | 'unreadable_response' | 'conflict_surfaced' }
  | { ok: false; reason: 'rejected'; cause: string }
  | { ok: false; reason: 'write_failed'; code: string | null }

export type UseDraftMutationResult = {
  applyDraftMutation: (mutate: DraftMutation) => Promise<DraftMutationOutcome>
  retryLastMutation: () => Promise<boolean>
}

/**
 * Every draft edit is a full replacement, so the cycle is fixed: read the
 * current project, parse `draftSpec`, apply the change, send the whole object
 * back with the project version header. Reading the project here — rather than
 * trusting a cached copy — is what stops one browser tab from erasing a screen
 * the other tab added.
 */
export function useDraftMutation(projectId: string, projectUpdatedAt: string | null, contextId: string): UseDraftMutationResult {
  const t = useT()
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId })

  const applyDraftMutation = React.useCallback(async (mutate: DraftMutation): Promise<DraftMutationOutcome> => {
    const current = await apiCall<unknown>(`/api/delivery_os/projects/${encodeURIComponent(projectId)}`)
    const project = projectDetailSchema.safeParse(current.result)
    if (!current.ok || !project.success) return { ok: false, reason: 'load_failed' }
    const draft = readDraftSpec(project.data.draftSpec)
    if (!draft.ok) return { ok: false, reason: 'unparsable' }
    const mutated = mutate(draft.draft)
    if (!mutated.ok) return { ok: false, reason: 'rejected', cause: mutated.reason }

    const version = project.data.updatedAt ?? projectUpdatedAt
    try {
      const call = await runMutation({
        operation: async () => {
          const response = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(version),
            () => apiCall<unknown>('/api/delivery_os/projects', {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: projectId, draftSpec: mutated.draft }),
            }),
          )
          if (!response.ok) {
            throw Object.assign(new Error('[internal] delivery_os.projects.update failed'), {
              status: response.status,
              ...((response.result as Record<string, unknown> | null) ?? {}),
            })
          }
          return response
        },
        context: {
          formId: contextId,
          resourceKind: 'delivery_os.project',
          resourceId: projectId,
          retryLastMutation,
        },
        mutationPayload: { id: projectId },
      })
      const body = projectUpdateResponseSchema.safeParse(call.result)
      if (!body.success) return { ok: false, reason: 'unreadable_response' }
      return { ok: true, projectUpdatedAt: body.data.updatedAt, draft: mutated.draft }
    } catch (error) {
      if (surfaceRecordConflict(error, t)) return { ok: false, reason: 'conflict_surfaced' }
      const code = (error as { code?: unknown } | null)?.code
      return { ok: false, reason: 'write_failed', code: typeof code === 'string' ? code : null }
    }
  }, [contextId, projectId, projectUpdatedAt, retryLastMutation, runMutation, t])

  return { applyDraftMutation, retryLastMutation }
}
