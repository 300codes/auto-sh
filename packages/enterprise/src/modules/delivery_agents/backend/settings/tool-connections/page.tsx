"use client"

import * as React from 'react'
import { RotateCw } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const TOOLS_URL = '/api/delivery_agents/tools'
const POLL_INTERVAL_MS = 3_000
const MUTATION_CONTEXT_ID = 'delivery_agents.tool_connections'

type ToolState = 'not_installed' | 'not_connected' | 'pending_login' | 'connected' | 'expired' | 'error'
type ToolAction = 'check' | 'connect' | 'cancel' | 'disconnect'

type ToolStatus = {
  id: string
  host: string
  installed: boolean
  version: string | null
  state: ToolState
  account: string | null
  detail: string | null
  loginUrl: string | null
  lastCheckedAt: string
  lastLogin: { outcome: 'success' | 'failed' | 'cancelled' | 'timeout'; finishedAt: string } | null
}

const STATE_VARIANTS: Record<ToolState, StatusBadgeVariant> = {
  not_installed: 'neutral',
  not_connected: 'warning',
  pending_login: 'info',
  connected: 'success',
  expired: 'warning',
  error: 'error',
}

function isToolList(value: unknown): value is { host: string; tools: ToolStatus[] } {
  return typeof value === 'object' && value !== null && Array.isArray((value as { tools?: unknown }).tools)
}

function isToolResult(value: unknown): value is { tool: ToolStatus } {
  return typeof value === 'object' && value !== null && typeof (value as { tool?: unknown }).tool === 'object'
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function ToolRow({
  tool,
  canManage,
  busyAction,
  onAction,
}: {
  tool: ToolStatus
  canManage: boolean
  busyAction: ToolAction | null
  onAction: (tool: ToolStatus, action: ToolAction) => void
}) {
  const t = useT()
  const busy = busyAction !== null
  const canConnect = tool.state === 'not_connected' || tool.state === 'expired' || tool.state === 'error'
  const button = (action: ToolAction, label: string, variant: 'default' | 'outline' | 'destructive' = 'outline') => (
    <Button key={action} size="sm" variant={variant} disabled={busy} onClick={() => onAction(tool, action)}>
      {busyAction === action ? <Spinner className="size-4" /> : null}
      {label}
    </Button>
  )
  const actions: React.ReactNode[] = [button('check', t('delivery_agents.tools.action.check', 'Check connection'))]
  if (canManage && canConnect) {
    const label =
      tool.state === 'expired'
        ? t('delivery_agents.tools.action.reconnect', 'Log in again')
        : t('delivery_agents.tools.action.connect', 'Connect / Log in')
    actions.unshift(button('connect', label, 'default'))
  }
  if (canManage && tool.state === 'pending_login') {
    actions.push(button('cancel', t('delivery_agents.tools.action.cancel', 'Cancel login')))
  }
  if (canManage && tool.state === 'connected') {
    actions.push(button('disconnect', t('delivery_agents.tools.action.disconnect', 'Disconnect'), 'destructive'))
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle>{t(`delivery_agents.tools.tool.${tool.id}.name`, tool.id)}</CardTitle>
          <CardDescription>{t(`delivery_agents.tools.tool.${tool.id}.description`, '')}</CardDescription>
        </div>
        <StatusBadge variant={STATE_VARIANTS[tool.state]} dot>
          {t(`delivery_agents.tools.state.${tool.state}`, tool.state)}
        </StatusBadge>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{t('delivery_agents.tools.field.host', 'Host')}</dt>
            <dd>{tool.host}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{t('delivery_agents.tools.field.version', 'Version')}</dt>
            <dd>{tool.version ?? '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{t('delivery_agents.tools.field.account', 'Account')}</dt>
            <dd className="break-all">{tool.account ?? '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{t('delivery_agents.tools.field.lastChecked', 'Last checked')}</dt>
            <dd>{formatTime(tool.lastCheckedAt)}</dd>
          </div>
          {tool.lastLogin ? (
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t('delivery_agents.tools.field.lastLogin', 'Last login attempt')}</dt>
              <dd>
                {t(`delivery_agents.tools.login.${tool.lastLogin.outcome}`, tool.lastLogin.outcome)} ·{' '}
                {formatTime(tool.lastLogin.finishedAt)}
              </dd>
            </div>
          ) : null}
        </dl>
        {tool.state === 'not_installed' ? (
          <p className="text-sm text-muted-foreground">{t(`delivery_agents.tools.tool.${tool.id}.install`, '')}</p>
        ) : null}
        {tool.detail ? (
          <p className="text-sm text-muted-foreground">{t(`delivery_agents.tools.detail.${tool.detail}`, tool.detail)}</p>
        ) : null}
        {tool.state === 'pending_login' ? (
          <p className="text-sm text-muted-foreground">
            {t('delivery_agents.tools.pendingHint', 'Finish the login in the browser opened on the host.')}{' '}
            {tool.loginUrl ? (
              <a className="text-primary underline" href={tool.loginUrl} target="_blank" rel="noreferrer noopener">
                {t('delivery_agents.tools.openLoginPage', 'Open the login page')}
              </a>
            ) : null}
          </p>
        ) : null}
        {tool.id === 'figma_mcp' && tool.state === 'connected' ? (
          <p className="text-sm text-muted-foreground">
            {t('delivery_agents.tools.figmaFileAccessHint', 'A connected server does not prove access to the project file.')}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">{actions}</div>
      </CardContent>
    </Card>
  )
}

export default function ToolConnectionsPage() {
  const t = useT()
  const { payload: chromePayload } = useBackendChrome()
  const canManage = hasFeature(chromePayload?.grantedFeatures, 'delivery_agents.tools.manage')
  const { runMutation } = useGuardedMutation({ contextId: MUTATION_CONTEXT_ID })
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [tools, setTools] = React.useState<ToolStatus[]>([])
  const [host, setHost] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<{ toolId: string; action: ToolAction } | null>(null)

  const replaceTool = React.useCallback((next: ToolStatus) => {
    setTools((current) => current.map((tool) => (tool.id === next.id ? next : tool)))
  }, [])

  const load = React.useCallback(async () => {
    setIsRefreshing(true)
    const call = await apiCall<unknown>(TOOLS_URL)
    if (call.ok && isToolList(call.result)) {
      setTools(call.result.tools)
      setHost(call.result.host)
      setLoadError(null)
    } else {
      setLoadError(t('delivery_agents.tools.loadError', 'Could not read tool connections.'))
    }
    setIsRefreshing(false)
    setIsLoading(false)
  }, [t])

  React.useEffect(() => {
    void load()
  }, [load])

  const pendingIds = tools.filter((tool) => tool.state === 'pending_login').map((tool) => tool.id)
  const pendingKey = pendingIds.join(',')

  React.useEffect(() => {
    if (!pendingKey) return
    const interval = setInterval(() => {
      for (const toolId of pendingKey.split(',')) {
        void apiCall<unknown>(`${TOOLS_URL}?toolId=${encodeURIComponent(toolId)}`).then((call) => {
          if (call.ok && isToolList(call.result) && call.result.tools[0]) replaceTool(call.result.tools[0])
        })
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [pendingKey, replaceTool])

  const handleAction = React.useCallback(
    async (tool: ToolStatus, action: ToolAction) => {
      if (action === 'disconnect') {
        const confirmed = await confirm({
          title: t('delivery_agents.tools.disconnectConfirm.title', 'Disconnect this tool?'),
          text: t(
            'delivery_agents.tools.disconnectConfirm.text',
            'The session on the host is removed for every organization that runs tasks on it. Sites and files are kept.',
          ),
          variant: 'destructive',
        })
        if (!confirmed) return
      }
      setBusy({ toolId: tool.id, action })
      try {
        await runMutation({
          context: { contextId: MUTATION_CONTEXT_ID },
          operation: async () => {
            const call = await apiCall<unknown>(TOOLS_URL, {
              method: 'POST',
              body: JSON.stringify({ toolId: tool.id, action }),
            })
            if (!call.ok || !isToolResult(call.result)) {
              flash(t('delivery_agents.tools.actionError', 'The action on the tool failed.'), 'error')
              return
            }
            replaceTool(call.result.tool)
          },
        })
      } finally {
        setBusy(null)
      }
    },
    [confirm, replaceTool, runMutation, t],
  )

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <div className="flex justify-center py-16">
            <Spinner className="size-5" />
          </div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader
        title={t('delivery_agents.tools.title', 'Tool connections')}
        description={
          host
            ? t('delivery_agents.tools.descriptionWithHost', 'Tools used by delivery agents on host {host}.', { host })
            : t('delivery_agents.tools.description', 'Tools used by delivery agents on the execution host.')
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            aria-label={t('delivery_agents.tools.refresh', 'Refresh all')}
            disabled={isRefreshing}
            onClick={() => void load()}
          >
            <RotateCw className={isRefreshing ? 'size-4 animate-spin' : 'size-4'} />
          </Button>
        }
      />
      <PageBody>
        {loadError ? <ErrorMessage label={loadError} /> : null}
        <div className="space-y-4">
          {tools.map((tool) => (
            <ToolRow
              key={tool.id}
              tool={tool}
              canManage={canManage}
              busyAction={busy?.toolId === tool.id ? busy.action : null}
              onAction={(target, action) => void handleAction(target, action)}
            />
          ))}
        </div>
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
