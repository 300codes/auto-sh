'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { MAX_RESULT_MANIFEST_CHARS } from './resultImport'

export type ManifestInputProps = {
  value: string
  onChange: (raw: string) => void
  /** Accessible name of the raw payload field behind the technical disclosure. */
  label: string
  description: string
  textareaId?: string
  textareaTestId: string
  rows?: number
  onSubmitShortcut?: () => void
}

async function readFileText(file: File): Promise<string | null> {
  try {
    if (typeof file.text === 'function') return await file.text()
  } catch {
    return null
  }
  return null
}

/**
 * A manifest is a machine document: the operator receives it as a file or a
 * clipboard payload and never has to read it. The raw text stays reachable
 * behind a technical disclosure — debugging a refused import needs the literal
 * payload — but it is not the way in.
 */
export function ManifestInput({
  value,
  onChange,
  label,
  description,
  textareaId,
  textareaTestId,
  rows = 12,
  onSubmitShortcut,
}: ManifestInputProps) {
  const t = useT()
  const [problem, setProblem] = React.useState<string | null>(null)
  const [fileName, setFileName] = React.useState<string | null>(null)
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const fileInput = React.useRef<HTMLInputElement>(null)

  const accept = React.useCallback(async (file: File | null | undefined) => {
    if (!file) return
    setProblem(null)
    const text = await readFileText(file)
    if (text === null) {
      setProblem(t('delivery_os.task.manifestInput.fileUnreadable'))
      return
    }
    setFileName(file.name)
    onChange(text)
  }, [onChange, t])

  const pasteFromClipboard = React.useCallback(async () => {
    setProblem(null)
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (!clipboard || typeof clipboard.readText !== 'function') {
      setProblem(t('delivery_os.task.manifestInput.clipboardUnavailable'))
      setAdvancedOpen(true)
      return
    }
    try {
      const text = await clipboard.readText()
      setFileName(null)
      onChange(text)
    } catch {
      setProblem(t('delivery_os.task.manifestInput.clipboardRefused'))
      setAdvancedOpen(true)
    }
  }, [onChange, t])

  return (
    <div className="space-y-2" data-testid="manifest-input">
      <div
        className="rounded border border-dashed border-border p-4 text-center"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); void accept(event.dataTransfer?.files?.[0]) }}
      >
        <p className="text-sm">{description}</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <Button type="button" variant="outline" size="sm" data-testid="manifest-input-file" onClick={() => fileInput.current?.click()}>
            {t('delivery_os.task.manifestInput.chooseFile')}
          </Button>
          <Button type="button" variant="outline" size="sm" data-testid="manifest-input-paste" onClick={() => void pasteFromClipboard()}>
            {t('delivery_os.task.manifestInput.paste')}
          </Button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          data-testid="manifest-input-file-field"
          onChange={(event) => void accept(event.target.files?.[0])}
        />
      </div>

      {value.trim().length > 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="manifest-input-loaded">
          {fileName
            ? t('delivery_os.task.manifestInput.loadedFile', { name: fileName, count: value.trim().length })
            : t('delivery_os.task.manifestInput.loaded', { count: value.trim().length })}
        </p>
      ) : null}

      {problem ? (
        <p className="text-sm text-status-error-text" data-testid="manifest-input-problem">{problem}</p>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={advancedOpen}
        data-testid="manifest-input-advanced-toggle"
        onClick={() => setAdvancedOpen((current) => !current)}
      >
        {t(advancedOpen ? 'delivery_os.task.manifestInput.hideRaw' : 'delivery_os.task.manifestInput.showRaw')}
      </Button>

      <div hidden={!advancedOpen} data-testid="manifest-input-advanced">
        <p className="mb-1 text-xs text-muted-foreground">{t('delivery_os.task.manifestInput.rawHelp')}</p>
        <Textarea
          id={textareaId}
          data-testid={textareaTestId}
          aria-label={label}
          value={value}
          rows={rows}
          className="font-mono text-xs"
          onChange={(event) => { setFileName(null); setProblem(null); onChange(event.target.value) }}
          onKeyDown={(event) => {
            if (onSubmitShortcut && (event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              onSubmitShortcut()
            }
          }}
        />
        <p className="mt-1 text-xs text-muted-foreground" data-testid="manifest-input-counter">
          {t('delivery_os.task.result.charCount', { count: value.trim().length, limit: MAX_RESULT_MANIFEST_CHARS })}
        </p>
      </div>
    </div>
  )
}
