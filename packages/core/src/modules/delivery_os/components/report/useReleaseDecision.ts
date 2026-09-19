'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { deployDecisionCreateResponseSchema } from '../../api/schemas'
import type { ReportSnapshot } from './useDeliveryReport'
import { decisionBlocker, decisionFingerprint, decisionPayload, type ReleaseDecisionKind, type ReleaseVerdict } from './decisionInput'

export function useReleaseDecision({ snapshot, kind, verdict, refresh, onSaved }: {
  snapshot: ReportSnapshot; kind: ReleaseDecisionKind; verdict: ReleaseVerdict
  refresh: () => Promise<ReportSnapshot | null>; onSaved: () => void
}) {
  const t = useT()
  const [reviewed, setReviewed] = React.useState(snapshot)
  const [problem, setProblem] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [locked, setLocked] = React.useState(false)
  const [blockers, setBlockers] = React.useState<string[]>([])
  const lifecycle = React.useRef({ active: true, busy: false, locked: false, reviewed: decisionFingerprint(snapshot) })
  React.useEffect(() => { lifecycle.current.active = true; return () => { lifecycle.current.active = false } }, [])
  const contextId = `delivery-report-${kind}-${snapshot.project.id}`
  const { runMutation, retryLastMutation } = useGuardedMutation({ contextId })
  const markLocked = (key: string) => {
    lifecycle.current.locked = true
    setLocked(true)
    setProblem(key)
  }
  const reviewAgain = async () => {
    if (lifecycle.current.busy) return
    const fresh = await refresh()
    if (!fresh || !lifecycle.current.active) { setProblem('refreshRequired'); return }
    setReviewed(fresh)
    lifecycle.current.reviewed = decisionFingerprint(fresh)
    lifecycle.current.locked = false
    setLocked(false)
    setProblem(null)
    setBlockers([])
  }
  const submit = async (reason: string) => {
    if (lifecycle.current.busy || lifecycle.current.locked || !lifecycle.current.active) return
    if (verdict === 'rejected' && !reason.trim()) { setProblem('reasonRequired'); return }
    const expected = lifecycle.current.reviewed
    const operation = async () => {
      if (!lifecycle.current.active || lifecycle.current.locked || lifecycle.current.busy) throw new Error('[internal] Decision unavailable')
      lifecycle.current.busy = true
      setBusy(true)
      let posted = false
      try {
        const fresh = await refresh()
        if (!fresh || !lifecycle.current.active) { setProblem('refreshRequired'); throw new Error('[internal] Refresh failed') }
        if (decisionFingerprint(fresh) !== expected || expected !== lifecycle.current.reviewed) {
          setReviewed(fresh)
          markLocked('contextChanged')
          throw new Error('[internal] Decision context changed')
        }
        const blocker = decisionBlocker(fresh, kind, verdict)
        if (blocker) { setProblem(blocker); throw new Error('[internal] Decision blocked') }
        posted = true
        const response = await withScopedApiRequestHeaders(buildOptimisticLockHeader(fresh.report.projectUpdatedAt), () =>
          apiCall<unknown>(`/api/delivery_os/projects/${encodeURIComponent(fresh.project.id)}/${kind}-decisions`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify(decisionPayload(fresh, kind, verdict, reason)),
          }))
        if (!response.ok) {
          if (response.status >= 500) throw new Error('[internal] Ambiguous decision response')
          posted = false
          const body = response.result && typeof response.result === 'object' ? response.result : {}
          const error = Object.assign(new Error('[internal] Decision rejected'), body, { status: response.status })
          if (response.status === 409) {
            surfaceRecordConflict(error, t)
            markLocked('contextChanged')
          } else if (response.status === 422) {
            setProblem('serverBlocked')
            if ('details' in body && Array.isArray(body.details)) setBlockers(body.details.map((item: unknown) => {
              if (!item || typeof item !== 'object') return ''
              const detail = item as Record<string, unknown>
              return [detail.path, detail.code].filter((value) => typeof value === 'string').join(': ')
            }).filter(Boolean))
          } else setProblem(response.status === 428 ? 'lockRequired' : response.status === 403 ? 'forbidden' : 'failed')
          throw error
        }
        const result = deployDecisionCreateResponseSchema.safeParse(response.result)
        if (!result.success) throw new Error('[internal] Ambiguous decision response')
        posted = false
        lifecycle.current.locked = true
        setLocked(true)
        setReviewed({ ...fresh, project: { ...fresh.project, updatedAt: result.data.projectUpdatedAt }, report: { ...fresh.report, projectUpdatedAt: result.data.projectUpdatedAt } })
        await refresh()
        if (lifecycle.current.active) onSaved()
        return result.data
      } catch (error) {
        if (posted) {
          markLocked('ambiguous')
          const reconciled = await refresh()
          if (reconciled && lifecycle.current.active) setReviewed(reconciled)
        }
        throw error
      } finally {
        lifecycle.current.busy = false
        if (lifecycle.current.active) setBusy(false)
      }
    }
    try {
      await runMutation({ operation, context: { formId: contextId, resourceKind: 'delivery_os.project', resourceId: snapshot.project.id, retryLastMutation }, mutationPayload: { kind, verdict } })
    } catch {
      return
    }
  }
  return { reviewed, problem, busy, locked, blockers, submit, reviewAgain }
}
