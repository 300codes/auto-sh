'use client'

import * as React from 'react'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { projectDetailSchema, type ProjectDetail } from '../../api/schemas'
import { deliveryReportV1Schema, isSameRevision, type DeliveryReportV1 } from '../../lib/contracts'
import { readReportSelection, reportQuery, reportRetryDelay, shouldPollReport } from './reportView'

export type ReportSnapshot = { project: ProjectDetail; report: DeliveryReportV1; readAt: string }
export type ReportState = {
  key: string
  status: 'loading' | 'ready' | 'error' | 'forbidden' | 'notFound' | 'noBaseline' | 'invalid'
  snapshot: ReportSnapshot | null
  stale: boolean
  refreshing: boolean
}

export function useDeliveryReport(projectId: string, query: string) {
  const scopeVersion = useOrganizationScopeVersion()
  const key = JSON.stringify([scopeVersion, projectId, query])
  const [state, setState] = React.useState<ReportState>({ key, status: 'loading', snapshot: null, stale: false, refreshing: true })
  const reloadRef = React.useRef<() => Promise<ReportSnapshot | null>>(async () => null)
  const refresh = React.useCallback(() => reloadRef.current(), [])

  React.useEffect(() => {
    const selection = readReportSelection(query)
    let disposed = false
    let generation = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending: Promise<ReportSnapshot | null> | null = null
    let last: ReportSnapshot | null = null
    let failures = 0
    let terminal = false
    let refreshAfterPending = false
    const visible = () => document.visibilityState !== 'hidden'
    const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined }
    const publish = (status: ReportState['status'], stale = false, refreshing = false) => {
      if (!disposed) setState({ key, status, snapshot: last, stale, refreshing })
    }
    const schedule = (delay: number) => {
      clearTimer()
      if (!disposed && visible() && !terminal) timer = setTimeout(() => { void load() }, delay)
    }
    const stop = (status: ReportState['status']) => {
      terminal = true
      last = null
      clearTimer()
      publish(status)
    }
    const load = (): Promise<ReportSnapshot | null> => {
      if (disposed || !visible() || selection.kind === 'invalid') return Promise.resolve(null)
      if (pending) return pending
      clearTimer()
      terminal = false
      const requestGeneration = generation
      const current = () => !disposed && visible() && requestGeneration === generation
      publish(last ? 'ready' : 'loading', Boolean(last), true)
      pending = (async () => {
        try {
          const projectResponse = await apiCall<unknown>(`/api/delivery_os/projects/${encodeURIComponent(projectId)}`)
          if (!current()) return null
          if ([401, 403, 404].includes(projectResponse.status)) {
            stop(projectResponse.status === 404 ? 'notFound' : 'forbidden')
            return null
          }
          const project = projectDetailSchema.safeParse(projectResponse.result)
          if (!projectResponse.ok || !project.success || project.data.id !== projectId) throw new Error('[internal] Invalid report project')
          if (selection.kind === 'current' && !project.data.activeBaselineId) { stop('noBaseline'); return null }
          const baselineId = selection.kind === 'history' ? selection.baselineId : project.data.activeBaselineId!
          const response = await apiCall<unknown>(`/api/delivery_os/projects/${encodeURIComponent(projectId)}/report?${reportQuery(selection, baselineId)}`)
          if (!current()) return null
          if ([401, 403, 404].includes(response.status)) { stop(response.status === 404 ? 'notFound' : 'forbidden'); return null }
          const report = deliveryReportV1Schema.safeParse(response.result)
          if (!response.ok || !report.success || report.data.projectId !== projectId || report.data.baselineId !== baselineId
            || (selection.kind === 'history' && (!report.data.revision || !isSameRevision(report.data.revision, selection.revision)))) {
            throw new Error('[internal] Invalid delivery report')
          }
          last = { project: project.data, report: report.data, readAt: new Date().toISOString() }
          failures = 0
          publish('ready')
          if (project.data.status !== 'archived' && shouldPollReport(report.data, selection.kind === 'history')) schedule(5_000)
          return last
        } catch {
          if (current()) {
            failures += 1
            publish(last ? 'ready' : 'error', Boolean(last))
            schedule(reportRetryDelay(failures))
          }
          return null
        } finally {
          pending = null
          if (refreshAfterPending && !disposed && visible()) {
            refreshAfterPending = false
            void load()
          }
        }
      })()
      return pending
    }
    const onVisibility = () => {
      generation += 1
      clearTimer()
      if (!visible()) { if (last) publish('ready', true); return }
      if (terminal) return
      if (pending) refreshAfterPending = true
      else void load()
    }
    reloadRef.current = load
    publish(selection.kind === 'invalid' ? 'invalid' : 'loading')
    if (selection.kind !== 'invalid') void load()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      generation += 1
      clearTimer()
      document.removeEventListener('visibilitychange', onVisibility)
      reloadRef.current = async () => null
    }
  }, [key, projectId, query])

  return {
    state: state.key === key ? state : { key, status: 'loading' as const, snapshot: null, stale: false, refreshing: true },
    refresh,
    historical: readReportSelection(query).kind === 'history',
  }
}
