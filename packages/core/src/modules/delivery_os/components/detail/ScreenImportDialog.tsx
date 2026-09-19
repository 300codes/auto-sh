'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { appendScreen } from './draftSpec'
import { useDraftMutation } from './useDraftMutation'
import {
  buildScreenRef,
  isHashingAvailable,
  uploadScreenRender,
  type ScreenMetadataInput,
} from './screenUpload'

export type ScreenImportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  projectUpdatedAt: string | null
  onSaved: (projectUpdatedAt: string) => void
}

const CONTEXT_ID = 'delivery-project-screen-import'

const EMPTY_METADATA: ScreenMetadataInput = {
  name: '',
  fileKey: null,
  nodeId: null,
  viewportWidth: 1440,
  viewportHeight: 1024,
  figmaVersion: null,
}

function blankOrValue(raw: string): string | null {
  const trimmed = raw.trim()
  return trimmed.length === 0 ? null : trimmed
}

export function ScreenImportDialog({ open, onOpenChange, projectId, projectUpdatedAt, onSaved }: ScreenImportDialogProps) {
  const t = useT()
  const [metadata, setMetadata] = React.useState<ScreenMetadataInput>(EMPTY_METADATA)
  const [file, setFile] = React.useState<File | null>(null)
  const [problem, setProblem] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const { applyDraftMutation } = useDraftMutation(projectId, projectUpdatedAt, CONTEXT_ID)
  const { runMutation, retryLastMutation } = useGuardedMutation({ contextId: `${CONTEXT_ID}-upload` })
  const pending = React.useRef(false)

  React.useEffect(() => {
    if (open) return
    setMetadata(EMPTY_METADATA)
    setFile(null)
    setProblem(null)
  }, [open])

  const hashingAvailable = isHashingAvailable()

  const submit = React.useCallback(async () => {
    if (pending.current) return
    setProblem(null)
    if (!hashingAvailable) {
      setProblem(t('delivery_os.project.screens.error.insecureContext'))
      return
    }
    if (metadata.name.trim().length === 0) {
      setProblem(t('delivery_os.project.screens.error.nameRequired'))
      return
    }
    if (file === null) {
      setProblem(t('delivery_os.project.screens.error.fileRequired'))
      return
    }
    setSaving(true)
    pending.current = true
    try {
      const uploaded = await uploadScreenRender(file, projectId, async (form) => {
        const response = await runMutation({
          operation: () => apiCall<unknown>('/api/attachments', { method: 'POST', body: form }),
          context: { resourceKind: 'delivery_os.project', resourceId: projectId, retryLastMutation },
        })
        return { ok: response.ok, status: response.status, result: response.result }
      })
      if (!uploaded.ok) {
        setProblem(
          uploaded.reason === 'insecure_context' ? t('delivery_os.project.screens.error.insecureContext')
            : uploaded.reason === 'unsupported_type' ? t('delivery_os.project.screens.error.unsupportedType', { mimeType: uploaded.mimeType })
            : uploaded.reason === 'too_large' ? t('delivery_os.project.screens.error.tooLarge', { sizeBytes: uploaded.sizeBytes, limit: uploaded.limit })
            : uploaded.reason === 'unreadable_response' ? t('delivery_os.project.screens.error.unreadableUpload')
            : t('delivery_os.project.screens.error.uploadFailed', { status: uploaded.status }),
        )
        return
      }
      const screen = buildScreenRef(metadata, uploaded.render, new Date().toISOString())
      const outcome = await applyDraftMutation((draft) => ({ ok: true, draft: appendScreen(draft, screen) }))
      if (outcome.ok) {
        flash(t('delivery_os.project.screens.saved', { name: screen.name }), 'success')
        onSaved(outcome.projectUpdatedAt)
        onOpenChange(false)
        return
      }
      if (outcome.reason === 'conflict_surfaced') return
      setProblem(
        outcome.reason === 'unparsable' ? t('delivery_os.project.draft.unparsable')
          : outcome.reason === 'load_failed' ? t('delivery_os.project.draft.loadFailed')
          : outcome.reason === 'unreadable_response' ? t('delivery_os.project.draft.unreadableResponse')
          : t('delivery_os.project.draft.writeFailed'),
      )
    } catch {
      setProblem(t('delivery_os.designImport.uploadError'))
    } finally {
      pending.current = false
      setSaving(false)
    }
  }, [applyDraftMutation, file, hashingAvailable, metadata, onOpenChange, onSaved, projectId, retryLastMutation, runMutation, t])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void submit()
    }
  }, [submit])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-testid="screen-import-dialog" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('delivery_os.project.screens.title')}</DialogTitle>
          <DialogDescription>{t('delivery_os.project.screens.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!hashingAvailable ? (
            <p data-testid="screen-import-insecure" className="text-sm text-status-error-text">
              {t('delivery_os.project.screens.error.insecureContext')}
            </p>
          ) : null}
          <div>
            <Label htmlFor="screen-name">{t('delivery_os.project.screens.fields.name')}</Label>
            <Input
              id="screen-name"
              value={metadata.name}
              onChange={(event) => setMetadata((current) => ({ ...current, name: event.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="screen-file-key">{t('delivery_os.project.screens.fields.fileKey')}</Label>
              <Input
                id="screen-file-key"
                value={metadata.fileKey ?? ''}
                onChange={(event) => setMetadata((current) => ({ ...current, fileKey: blankOrValue(event.target.value) }))}
              />
            </div>
            <div>
              <Label htmlFor="screen-node-id">{t('delivery_os.project.screens.fields.nodeId')}</Label>
              <Input
                id="screen-node-id"
                value={metadata.nodeId ?? ''}
                onChange={(event) => setMetadata((current) => ({ ...current, nodeId: blankOrValue(event.target.value) }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="screen-width">{t('delivery_os.project.screens.fields.width')}</Label>
              <Input
                id="screen-width"
                type="number"
                value={metadata.viewportWidth}
                onChange={(event) => setMetadata((current) => ({ ...current, viewportWidth: Number(event.target.value) }))}
              />
            </div>
            <div>
              <Label htmlFor="screen-height">{t('delivery_os.project.screens.fields.height')}</Label>
              <Input
                id="screen-height"
                type="number"
                value={metadata.viewportHeight}
                onChange={(event) => setMetadata((current) => ({ ...current, viewportHeight: Number(event.target.value) }))}
              />
            </div>
            <div>
              <Label htmlFor="screen-figma-version">{t('delivery_os.project.screens.fields.figmaVersion')}</Label>
              <Input
                id="screen-figma-version"
                value={metadata.figmaVersion ?? ''}
                onChange={(event) => setMetadata((current) => ({ ...current, figmaVersion: blankOrValue(event.target.value) }))}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="screen-render">{t('delivery_os.project.screens.fields.render')}</Label>
            <input
              id="screen-render"
              data-testid="screen-import-file"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="mt-1 block w-full text-sm"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <p className="mt-1 text-xs text-muted-foreground">{t('delivery_os.project.screens.renderHelp')}</p>
          </div>
          {problem ? (
            <p data-testid="screen-import-problem" className="text-sm text-status-error-text">{problem}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('delivery_os.project.screens.cancel')}
          </Button>
          <Button
            type="button"
            disabled={saving || !hashingAvailable}
            data-testid="screen-import-submit"
            onClick={() => void submit()}
          >
            {t('delivery_os.project.screens.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
