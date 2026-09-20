'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'
import { parseStageArtifactDocument } from './artifactContent'
import type { StageArtifactV1 } from '../../lib/contracts'

/**
 * The machine payload stays reachable, but it is a technical path: the document
 * is parsed and rendered for human review before anything can be submitted.
 */
export function StageArtifactImport({ projectId, stageId, onParsed }: { projectId: string; stageId: string; onParsed: (artifact: StageArtifactV1) => void }) {
  const t = useT()
  const [raw, setRaw] = React.useState('')
  const [reason, setReason] = React.useState<'json' | 'document' | null>(null)
  const check = () => {
    const result = parseStageArtifactDocument(raw, projectId, stageId)
    if (!result.ok) {
      setReason(result.reason)
      return
    }
    setReason(null)
    onParsed(result.artifact)
  }
  return (
    <div className="space-y-3" data-testid="delivery-stage-artifact-import">
      <p className="text-sm text-muted-foreground">{t('delivery_os.flow.artifact.importHint')}</p>
      <CollapsibleSection title={t('delivery_os.flow.artifact.technicalDocument')} defaultCollapsed>
        <div className="space-y-2">
          <Label htmlFor="delivery-stage-artifact-document">{t('delivery_os.flow.artifact.document')}</Label>
          <Textarea
            id="delivery-stage-artifact-document"
            rows={10}
            value={raw}
            onChange={(event) => { setRaw(event.target.value); setReason(null) }}
          />
          {reason ? (
            <Alert status="error" style="lighter" size="sm">
              {t(reason === 'json' ? 'delivery_os.flow.artifact.invalidJson' : 'delivery_os.flow.artifact.invalidDocument')}
            </Alert>
          ) : null}
          <Button type="button" variant="outline" disabled={raw.trim().length === 0} onClick={check}>
            {t('delivery_os.flow.artifact.check')}
          </Button>
        </div>
      </CollapsibleSection>
    </div>
  )
}

export function RawDocumentDisclosure({ payload }: { payload: unknown }) {
  const t = useT()
  return (
    <CollapsibleSection title={t('delivery_os.flow.artifact.rawDocument')} defaultCollapsed>
      <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs" data-testid="delivery-stage-raw-document">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </CollapsibleSection>
  )
}
