'use client'
import * as React from 'react'
import type { z } from 'zod'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { evidenceDetailResponseSchema, evidenceListResponseSchema, type EvidenceDetailResponse, type EvidenceListResponse } from '../../lib/evidenceReadContracts'
import type { SourceRevision } from '../../lib/contracts'
import { evidenceRevisionLabel } from './evidenceView'

type ReadState<T> = { key: string; status: 'loading' | 'ready' | 'error' | 'forbidden' | 'notFound'; data: T | null }
function useEvidenceRead<T>(url: string | null, schema: z.ZodType<T>, validate: (data: T) => boolean) {
  const scope = useOrganizationScopeVersion()
  const [retry, setRetry] = React.useState(0)
  const key = JSON.stringify([scope, url, retry])
  const [state, setState] = React.useState<ReadState<T>>({ key, status: 'loading', data: null })
  React.useEffect(() => {
    let disposed = false
    const controller = new AbortController()
    setState({ key, status: 'loading', data: null })
    if (url) void (async () => {
      try {
        const response = await apiCall<unknown>(url, { signal: controller.signal })
        if (disposed) return
        if (!response.ok) { setState({ key, status: response.status === 403 || response.status === 401 ? 'forbidden' : response.status === 404 ? 'notFound' : 'error', data: null }); return }
        const parsed = schema.safeParse(response.result)
        setState(parsed.success && validate(parsed.data) ? { key, status: 'ready', data: parsed.data } : { key, status: 'error', data: null })
      } catch { if (!disposed) setState({ key, status: 'error', data: null }) }
    })()
    return () => { disposed = true; controller.abort() }
  }, [key, url, schema, validate])
  return { ...(state.key === key ? state : { key, status: 'loading' as const, data: null }), reload: () => setRetry((value) => value + 1) }
}
export function useEvidenceDetail(projectId: string | undefined, evidenceId: string | null) {
  const validate = React.useCallback((data: EvidenceDetailResponse) => data.projectId === projectId && data.id === evidenceId, [projectId, evidenceId])
  return useEvidenceRead(projectId && evidenceId ? `/api/delivery_os/projects/${encodeURIComponent(projectId)}/evidence/${encodeURIComponent(evidenceId)}` : null, evidenceDetailResponseSchema, validate)
}
export function useEvidenceList(projectId: string, baselineId: string, revision: SourceRevision | null, group: 'revision' | 'baseline', offset: number) {
  const ref = evidenceRevisionLabel(revision)
  const query = new URLSearchParams({ baselineId, group, limit: '25', offset: String(offset) })
  if (group === 'revision' && ref) query.set('revision', ref)
  const validate = React.useCallback((data: EvidenceListResponse) => data.group === group && data.items.every((row) => row.projectId === projectId && row.baselineId === baselineId && (group === 'baseline' ? row.sourceRevision === null : evidenceRevisionLabel(row.sourceRevision) === ref)), [group, projectId, baselineId, ref])
  return useEvidenceRead(group === 'revision' && !ref ? null : `/api/delivery_os/projects/${encodeURIComponent(projectId)}/evidence?${query}`, evidenceListResponseSchema, validate)
}
