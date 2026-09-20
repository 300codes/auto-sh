'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CollapsibleSection, SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { TabEmptyState } from '@open-mercato/ui/backend/detail'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { designImportManifestSchema } from '../../lib/designImportContracts'
import { HashValue } from './HashValue'
import { ProposalIssueList } from './ProposalPreview'
import type { ProposalIssue } from './proposalImport'

export type DesignManifestFieldProps = {
  value: string
  onValueChange: (value: string) => void
}

type ManifestReading =
  | { kind: 'idle' }
  | { kind: 'notJson' }
  | { kind: 'invalid'; issues: ProposalIssue[] }
  | { kind: 'ready'; screens: ReturnType<typeof readScreens>; tokenCount: number; producedBy: string | null }

function readScreens(manifest: { screens: readonly { name: string; viewport: { width: number; height: number }; figmaVersion?: string; fileKey: string; nodeId: string; sha256: string }[] }) {
  return manifest.screens.map((screen) => ({
    name: screen.name,
    viewport: `${screen.viewport.width}×${screen.viewport.height}`,
    figmaVersion: screen.figmaVersion ?? null,
    fileKey: screen.fileKey,
    nodeId: screen.nodeId,
    sha256: screen.sha256,
  }))
}

export function readDesignManifest(raw: string): ManifestReading {
  if (raw.trim().length === 0) return { kind: 'idle' }
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return { kind: 'notJson' }
  }
  const parsed = designImportManifestSchema.safeParse(payload)
  if (!parsed.success) {
    return {
      kind: 'invalid',
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map((segment) => String(segment)).join('.'),
        code: issue.code,
        message: issue.message,
      })),
    }
  }
  return {
    kind: 'ready',
    screens: readScreens(parsed.data),
    tokenCount: Object.keys(parsed.data.tokens).length,
    producedBy: parsed.data.producedBy?.tool ?? null,
  }
}

/**
 * The manifest is a machine contract; what the operator starts an import from is
 * a file they drop and a list of screens they can read. The text itself stays
 * reachable for debugging, one disclosure away, and never as the default path.
 */
export function DesignManifestField({ value, onValueChange }: DesignManifestFieldProps) {
  const t = useT()
  const [fileProblem, setFileProblem] = React.useState(false)
  const reading = React.useMemo(() => readDesignManifest(value), [value])

  const loadFile = async (file: File | null | undefined) => {
    if (!file) return
    setFileProblem(false)
    try {
      onValueChange(await file.text())
    } catch {
      setFileProblem(true)
    }
  }

  return (
    <div className="space-y-3" data-testid="design-manifest-field">
      <div
        className="space-y-2 rounded-lg border border-dashed border-border p-4"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); void loadFile(event.dataTransfer.files?.[0]) }}
      >
        <Label htmlFor="design-manifest-file">{t('delivery_os.designImport.file')}</Label>
        <input
          id="design-manifest-file"
          data-testid="design-manifest-file"
          type="file"
          accept="application/json,.json"
          className="block w-full text-sm"
          onChange={(event) => { void loadFile(event.target.files?.[0]); event.target.value = '' }}
        />
        <p className="text-xs text-muted-foreground">{t('delivery_os.designImport.fileHint')}</p>
      </div>
      {reading.kind === 'idle' ? (
        <div data-testid="design-manifest-idle">
          <TabEmptyState
            title={t('delivery_os.designImport.idle.title')}
            description={t('delivery_os.designImport.idle.description')}
          />
        </div>
      ) : null}
      {reading.kind === 'notJson' ? (
        <p data-testid="design-manifest-problem" className="text-sm text-status-error-text">
          {t('delivery_os.designImport.notJson')}
        </p>
      ) : null}
      {reading.kind === 'invalid' ? (
        <ProposalIssueList issues={reading.issues} label={t('delivery_os.designImport.invalidManifest')} />
      ) : null}
      {fileProblem ? (
        <p data-testid="design-manifest-file-problem" className="text-sm text-status-error-text">
          {t('delivery_os.designImport.unreadableFile')}
        </p>
      ) : null}
      {reading.kind === 'ready' ? (
        <div className="space-y-3 rounded-lg border border-border p-4 text-xs" data-testid="design-manifest-preview">
          <SectionHeader title={t('delivery_os.designImport.previewTitle')} count={reading.screens.length} />
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="muted" size="sm">
              {t('delivery_os.designImport.previewTokens', { count: reading.tokenCount })}
            </Badge>
            <Badge variant="muted" size="sm">
              {t('delivery_os.project.import.preview.producedBy')}: {reading.producedBy ?? '—'}
            </Badge>
          </div>
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {reading.screens.map((screen) => (
              <li key={`${screen.fileKey}-${screen.nodeId}-${screen.viewport}-${screen.figmaVersion ?? ''}`} className="space-y-1 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{screen.name}</span>
                  <Badge variant="muted" size="sm">{screen.viewport}</Badge>
                  {screen.figmaVersion ? (
                    <Badge variant="muted" size="sm">
                      {t('delivery_os.project.sections.design.figmaVersion', { version: screen.figmaVersion })}
                    </Badge>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                  <span className="font-mono">{screen.nodeId}</span>
                  <HashValue value={screen.sha256} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <CollapsibleSection title={t('delivery_os.designImport.advanced')} defaultCollapsed>
        <div className="space-y-2">
          <Label htmlFor="design-manifest-raw">{t('delivery_os.designImport.manifest')}</Label>
          <Textarea
            id="design-manifest-raw"
            data-testid="design-manifest-raw"
            value={value}
            rows={10}
            className="font-mono text-xs"
            onChange={(event) => onValueChange(event.target.value)}
          />
        </div>
      </CollapsibleSection>
    </div>
  )
}
