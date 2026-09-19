'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { taskPackageV1Schema, type TaskPackageV1 } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { describeRevisionForDisplay } from './baseRevision'

export type TaskPackagePanelProps = {
  taskId: string
  /** `null` means no attempt is reserved — the export has no subject, and says so. */
  attemptId: string | null
}

type PackageState =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; code: string | null }
  | { status: 'ready'; taskPackage: TaskPackageV1 }

const PACKAGE_ERROR_KEYS: Record<string, string> = {
  not_found: 'delivery_os.task.package.error.notFound',
  attempt_not_found: 'delivery_os.task.package.error.attemptNotFound',
  attempt_cancelled: 'delivery_os.task.package.error.attemptCancelled',
  attempt_closed: 'delivery_os.task.package.error.attemptClosed',
  reconciliation_required: 'delivery_os.task.package.error.reconciliationRequired',
  baseline_not_active: 'delivery_os.task.package.error.baselineNotActive',
  forbidden: 'delivery_os.task.package.error.forbidden',
}

function serializePackage(taskPackage: TaskPackageV1): string {
  return JSON.stringify(taskPackage, null, 2)
}

/**
 * The viewer's browser is the only place the file can be produced; a download
 * that the environment refuses must therefore be reported, never swallowed.
 */
function downloadPackage(taskPackage: TaskPackageV1): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false
  try {
    const url = URL.createObjectURL(new Blob([serializePackage(taskPackage)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `task-package.${taskPackage.taskId}.${taskPackage.attemptId}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    return true
  } catch {
    return false
  }
}

function PackageFacts({ taskPackage }: { taskPackage: TaskPackageV1 }) {
  const t = useT()
  const rows: Array<[string, string]> = [
    ['delivery_os.task.package.fields.attemptId', taskPackage.attemptId],
    ['delivery_os.task.package.fields.baselineId', taskPackage.baselineId],
    ['delivery_os.task.package.fields.baselineHash', taskPackage.baselineHash.slice(0, 12)],
    ['delivery_os.task.package.fields.baseRevision', describeRevisionForDisplay(taskPackage.baseRevision)],
    ['delivery_os.task.package.fields.targetProfile', `${taskPackage.targetProfileId}@${taskPackage.targetProfileVersion}`],
    ['delivery_os.task.package.fields.acIds', taskPackage.acceptanceCriteria.map((criterion) => criterion.id).join(', ')],
    ['delivery_os.task.package.fields.allowedPaths', taskPackage.allowedPaths.join(', ')],
  ]
  return (
    <dl className="grid gap-2 sm:grid-cols-2" data-testid="task-package-facts">
      {rows.map(([labelKey, value]) => (
        <div key={labelKey} className="space-y-0.5">
          <dt className="text-xs font-medium text-muted-foreground">{t(labelKey)}</dt>
          <dd className="break-all font-mono text-xs">{value || '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

export function TaskPackagePanel({ taskId, attemptId }: TaskPackagePanelProps) {
  const t = useT()
  const [state, setState] = React.useState<PackageState>({ status: 'idle' })
  const [copyProblem, setCopyProblem] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const requestSequence = React.useRef(0)

  const load = React.useCallback(async (): Promise<void> => {
    if (attemptId === null) {
      setState({ status: 'idle' })
      return
    }
    const sequence = ++requestSequence.current
    setState({ status: 'loading' })
    try {
      const response = await apiCall<unknown>(
        `/api/delivery_os/tasks/${encodeURIComponent(taskId)}/package?attemptId=${encodeURIComponent(attemptId)}`,
      )
      if (sequence !== requestSequence.current) return
      const parsed = taskPackageV1Schema.safeParse(response.result)
      if (!response.ok || !parsed.success) {
        const code = (response.result as { code?: unknown } | null)?.code
        setState({ status: 'error', code: typeof code === 'string' ? code : null })
        return
      }
      setState({ status: 'ready', taskPackage: parsed.data })
    } catch {
      if (sequence === requestSequence.current) setState({ status: 'error', code: null })
    }
  }, [attemptId, taskId])

  React.useEffect(() => {
    setCopyProblem(null)
    setCopied(false)
    void load()
    return () => { requestSequence.current += 1 }
  }, [load])

  const copy = React.useCallback(async (taskPackage: TaskPackageV1) => {
    setCopyProblem(null)
    setCopied(false)
    try {
      const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
      if (!clipboard || typeof clipboard.writeText !== 'function') {
        setCopyProblem(t('delivery_os.task.package.error.clipboardUnavailable'))
        return
      }
      await clipboard.writeText(serializePackage(taskPackage))
      setCopied(true)
    } catch {
      setCopyProblem(t('delivery_os.task.package.error.clipboardRefused'))
    }
  }, [t])

  return (
    <div className="space-y-3 rounded border border-border p-4" data-testid="delivery-task-package">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{t('delivery_os.task.package.title')}</h3>
        <p className="text-xs text-muted-foreground">{t('delivery_os.task.package.description')}</p>
      </div>
      {attemptId === null ? (
        <p className="text-sm text-muted-foreground" data-testid="task-package-no-attempt">
          {t('delivery_os.task.package.noAttempt')}
        </p>
      ) : null}
      {state.status === 'loading' ? <LoadingMessage label={t('delivery_os.task.package.loading')} /> : null}
      {state.status === 'error' ? (
        <div className="space-y-2">
          <p className="text-sm text-status-error-text" data-testid="task-package-error">
            {t(state.code !== null && PACKAGE_ERROR_KEYS[state.code] ? PACKAGE_ERROR_KEYS[state.code] : 'delivery_os.task.package.error.unnamed')}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            {t('delivery_os.task.retry')}
          </Button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <div className="space-y-3">
          <PackageFacts taskPackage={state.taskPackage} />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="task-package-copy"
              onClick={() => void copy(state.taskPackage)}
            >
              {t('delivery_os.task.package.copy')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="task-package-download"
              onClick={() => {
                if (!downloadPackage(state.taskPackage)) setCopyProblem(t('delivery_os.task.package.error.downloadUnavailable'))
              }}
            >
              {t('delivery_os.task.package.download')}
            </Button>
            {copied ? (
              <span className="text-xs text-status-success-text" data-testid="task-package-copied">
                {t('delivery_os.task.package.copied')}
              </span>
            ) : null}
          </div>
          {copyProblem ? (
            <p className="text-sm text-status-error-text" data-testid="task-package-copy-problem">{copyProblem}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
