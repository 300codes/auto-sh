'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { designImportListSchema, designImportManifestSchema, designImportScreenIdentity, designImportScreenKey, designImportSessionSchema, type DesignImportSession } from '../../lib/designImportContracts'
import { useFlowQuery } from './useFlowQuery'
import { mapManifestScreens, uploadScreenRender } from './screenUpload'
import { ScreenPreview } from './DesignSection'

type Props = { projectId: string; projectUpdatedAt: string; canManage: boolean; onChanged: () => Promise<void> }
export function DesignManifestImport({ projectId, projectUpdatedAt, canManage, onChanged }: Props) {
  const t = useT()
  const [offset, setOffset] = React.useState(0)
  const query = useFlowQuery(`/api/delivery_os/projects/${projectId}/design-imports?offset=${offset}`, designImportListSchema)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const session = query.data?.items.find((item) => item.id === selectedId) ?? query.data?.items[0]
  const fields: CrudField[] = [{ id: 'manifest', label: t('delivery_os.designImport.manifest'), type: 'textarea', required: true }]
  const changed = React.useCallback(async () => { await Promise.all([query.reload(), onChanged()]) }, [query.reload, onChanged])
  return <section className="space-y-3 rounded border border-border p-4" data-testid="delivery-design-import">
    <h2 className="text-lg font-semibold">{t('delivery_os.designImport.title')}</h2>
    <p className="text-sm text-muted-foreground">{t('delivery_os.designImport.description')}</p>
    {canManage ? <CrudForm entityId="delivery_os:design_import_session" fields={fields} initialValues={{ manifest: '', updatedAt: projectUpdatedAt }} submitLabel={t('delivery_os.designImport.start')} onSubmit={async (values) => {
      let raw: unknown
      try { raw = JSON.parse(String(values.manifest)) } catch { throw createCrudFormError(t('delivery_os.flow.invalid')) }
      const parsed = designImportManifestSchema.safeParse(raw)
      if (!parsed.success) throw createCrudFormError(t('delivery_os.designImport.invalidManifest'))
      const response = await withScopedApiRequestHeaders(buildOptimisticLockHeader(projectUpdatedAt), () => apiCallOrThrow(`/api/delivery_os/projects/${projectId}/design-imports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ manifest: parsed.data }) }))
      const created = designImportSessionSchema.parse(response.result)
      setSelectedId(created.id)
      setOffset(0)
      await changed()
    }} /> : null}
    {query.loading && !query.data ? <LoadingMessage label={t('delivery_os.flow.loading')} /> : null}
    {query.error ? <ErrorMessage label={t('delivery_os.designImport.loadError')} action={<Button type="button" onClick={() => void query.reload()}>{t('delivery_os.task.retry')}</Button>} /> : null}
    {query.data ? <>
      <div className="flex flex-wrap gap-2">{query.data.items.map((item) => <Button key={item.id} type="button" variant={session?.id === item.id ? 'default' : 'outline'} onClick={() => setSelectedId(item.id)}>{item.manifestHash.slice(0, 12)} · {t(`delivery_os.designImport.status.${item.status}`)}</Button>)}</div>
      {query.data.items.length === 0 ? <p className="text-sm text-muted-foreground">{t('delivery_os.designImport.empty')}</p> : null}
      <div className="flex gap-2"><Button type="button" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>{t('delivery_os.flow.previous')}</Button><Button type="button" variant="ghost" disabled={query.data.items.length < 20} onClick={() => setOffset(offset + 20)}>{t('delivery_os.flow.next')}</Button></div>
    </> : null}
    {session && session.projectId === projectId ? <SessionProgress key={session.id} session={session} canManage={canManage} onChanged={changed} /> : null}
  </section>
}

function SessionProgress({ session, canManage, onChanged }: { session: DesignImportSession; canManage: boolean; onChanged: () => Promise<void> }) {
  const t = useT()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState(false)
  const pending = React.useRef(false)
  const { runMutation, retryLastMutation } = useGuardedMutation({ contextId: `delivery-design-import-${session.id}` })
  const write = async (body: Record<string, unknown>) => {
    const response = await withScopedApiRequestHeaders(buildOptimisticLockHeader(session.updatedAt), () => apiCallOrThrow(`/api/delivery_os/projects/${session.projectId}/design-imports/${session.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
    return designImportSessionSchema.parse(response.result)
  }
  const mutate = async (operation: () => Promise<unknown>) => {
    if (pending.current) return
    pending.current = true
    setBusy(true); setError(false)
    try {
      await runMutation({ operation, context: { resourceKind: 'delivery_os.design_import_session', resourceId: session.id, retryLastMutation } })
      await onChanged()
    } catch (caught) {
      if (!surfaceRecordConflict(caught, t)) setError(true)
      await onChanged()
    } finally { pending.current = false; setBusy(false) }
  }
  const upload = (key: string, file: File) => mutate(async () => {
    const selectedManifest = { ...session.manifest, screens: session.manifest.screens.filter((screen) => designImportScreenKey(screen) === key) }
    if (!selectedManifest.screens.length || !mapManifestScreens(selectedManifest, new Map([[key, file]]), 'screenVersion').ok) throw createCrudFormError(t('delivery_os.designImport.invalidManifest'))
    const uploaded = await uploadScreenRender(file, session.projectId, async (form) => {
      const result = await apiCall<unknown>('/api/attachments', { method: 'POST', body: form })
      return { ok: result.ok, status: result.status, result: result.result }
    })
    if (!uploaded.ok) throw createCrudFormError(t('delivery_os.designImport.uploadError'))
    await write({ renders: [{ key, attachmentId: uploaded.render.attachmentId }] })
  })
  const editable = canManage && session.status === 'partial'
  const select = (key: string) => {
    const screen = session.manifest.screens.find((item) => designImportScreenKey(item) === key)!
    const siblings = new Set(session.manifest.screens.filter((item) => designImportScreenIdentity(item) === designImportScreenIdentity(screen)).map(designImportScreenKey))
    void mutate(() => write({ selectedKeys: [...session.progress.selectedKeys.filter((item) => !siblings.has(item)), key] }))
  }
  const verified = session.progress.screens.filter((item) => item.screen !== null && item.errorCode === null).length
  const identityCount = new Set(session.manifest.screens.map(designImportScreenIdentity)).size
  return <div className="space-y-3" aria-busy={busy} data-testid="design-import-progress">
    <StatusBadge variant={session.status === 'complete' ? 'success' : 'neutral'}>{t(`delivery_os.designImport.status.${session.status}`)}</StatusBadge>
    <p>{t('delivery_os.designImport.progress', { completed: verified, total: session.manifest.screens.length })}</p>
    {error ? <ErrorMessage label={t('delivery_os.designImport.saveError')} /> : null}
    <ul className="space-y-3">{session.manifest.screens.map((screen, index) => {
      const key = designImportScreenKey(screen)
      const progress = session.progress.screens.find((item) => item.key === key)
      return <li key={key} className="space-y-2 rounded border border-border p-3">
        <p className="font-medium">{screen.name} · {screen.viewport.width}×{screen.viewport.height} · {screen.figmaVersion ?? '—'}</p>
        <p className="break-all text-xs text-muted-foreground">{screen.fileKey} / {screen.nodeId} · {screen.sha256}</p>
        {progress?.screen ? <ScreenPreview attachmentId={progress.screen.attachmentId} name={screen.name} /> : <p>{t('delivery_os.designImport.missingRender')}</p>}
        {progress?.errorCode ? <p role="alert" className="text-sm text-status-error-text">{t('delivery_os.designImport.verificationError', { code: progress.errorCode })}</p> : null}
        {editable ? <><Label htmlFor={`design-import-file-${index}`}>{t('delivery_os.designImport.render')}</Label><Input id={`design-import-file-${index}`} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(key, file); event.target.value = '' }} /></> : null}
        <label className="flex items-center gap-2"><input type="radio" name={`design-version-${session.id}-${designImportScreenIdentity(screen)}`} checked={session.progress.selectedKeys.includes(key)} disabled={!editable || busy} onChange={() => select(key)} />{t('delivery_os.designImport.selectVersion')}</label>
      </li>
    })}</ul>
    {editable ? <div className="flex gap-2"><Button type="button" disabled={busy || verified !== session.manifest.screens.length || session.progress.selectedKeys.length !== identityCount} onClick={() => void mutate(() => write({ action: 'complete' }))}>{t('delivery_os.designImport.complete')}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => void mutate(() => write({ action: 'cancel' }))}>{t('delivery_os.designImport.cancel')}</Button></div> : null}
  </div>
}
