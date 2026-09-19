'use client'

import * as React from 'react'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { resultReadResponseSchema, type AcceptedResultSummary } from '../../lib/resultReadContracts'

type ResultState =
  | { key: string; status: 'loading' | 'empty' | 'error' }
  | { key: string; status: 'ready'; result: AcceptedResultSummary }

export function useAcceptedResult(projectId: string, taskId: string, attemptId: string | null, evidenceId: string | null, version: string | null) {
  const scopeVersion = useOrganizationScopeVersion()
  const key = `${scopeVersion}:${projectId}:${taskId}:${attemptId}:${evidenceId}`
  const [state, setState] = React.useState<ResultState>({ key, status: 'loading' })
  const sequence = React.useRef(0)

  const reload = React.useCallback(async () => {
    const current = ++sequence.current
    if (!attemptId) { setState({ key, status: 'empty' }); return }
    setState((previous) => previous.key === key && previous.status === 'ready' ? previous : { key, status: 'loading' })
    try {
      const response = await apiCall<unknown>(`/api/delivery_os/tasks/${encodeURIComponent(taskId)}/results?attemptId=${encodeURIComponent(attemptId)}`)
      if (current !== sequence.current) return
      const parsed = resultReadResponseSchema.safeParse(response.result)
      if (!response.ok || !parsed.success) { setState({ key, status: 'error' }); return }
      const result = parsed.data.result
      if (result && (result.projectId !== projectId || result.taskId !== taskId || result.attemptId !== attemptId || (evidenceId && result.evidenceId !== evidenceId))) {
        setState({ key, status: 'error' })
        return
      }
      setState(result ? { key, status: 'ready', result } : { key, status: evidenceId ? 'error' : 'empty' })
    } catch {
      if (current === sequence.current) setState({ key, status: 'error' })
    }
  }, [key, projectId, taskId, attemptId, evidenceId, version])

  React.useEffect(() => {
    void reload()
    return () => { sequence.current += 1 }
  }, [reload])

  return { state: state.key === key ? state : { key, status: 'loading' as const }, reload }
}
