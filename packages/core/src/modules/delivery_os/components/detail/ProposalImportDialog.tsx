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
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import {
  baselineCreateResponseSchema,
  planImportResponseSchema,
} from '@open-mercato/core/modules/delivery_os/api/schemas'
import { deliveryErrorBodySchema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import {
  PlanProposalPreview,
  ProposalIssueList,
  RequirementsProposalPreview,
} from './ProposalPreview'
import {
  MAX_MANIFEST_BODY_CHARS,
  manifestTargetsProject,
  parsePlanProposal,
  parseRequirementsProposal,
  summarizePlanProposal,
  summarizeRequirementsProposal,
  type ProposalIssue,
} from './proposalImport'

/** Which proposal the dialog is importing; the two differ in schema, endpoint and outcome message. */
export type ProposalImportVariant = 'requirements' | 'plan'

export type ProposalImportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  variant?: ProposalImportVariant
  projectId: string
  projectUpdatedAt: string | null
  onImported: (projectUpdatedAt: string) => void
}

type ClientProblem =
  | { kind: 'empty' }
  | { kind: 'tooLarge'; length: number }
  | { kind: 'notJson' }
  | { kind: 'notObject' }
  | { kind: 'schema'; issues: ProposalIssue[] }
  | { kind: 'foreignProject' }

const MUTATION_CONTEXT_ID = 'delivery-project-proposal-import'

/**
 * Plan-import refusals arrive as a list: `details[]` names every field that
 * failed, not just the first. Rendering only `error` would throw away the part
 * the operator actually acts on.
 */
const PLAN_ERROR_KEYS: Record<string, string> = {
  unknown_ac: 'delivery_os.project.import.plan.error.unknownAc',
  unknown_test_id: 'delivery_os.project.import.plan.error.unknownTestId',
  duplicate_stable_id: 'delivery_os.project.import.plan.error.duplicateStableId',
  missing_required_tests: 'delivery_os.project.import.plan.error.missingRequiredTests',
  path_not_allowed: 'delivery_os.project.import.plan.error.pathNotAllowed',
  cycle: 'delivery_os.project.import.plan.error.cycle',
  foreign_dependency: 'delivery_os.project.import.plan.error.foreignDependency',
  baseline_mismatch: 'delivery_os.project.import.plan.error.baselineHashMismatch',
  baseline_not_active: 'delivery_os.project.import.plan.error.baselineNotActive',
  baseline_not_approved: 'delivery_os.project.import.plan.error.baselineNotApproved',
}

/**
 * Server codes that carry a distinct cause. Anything outside the map is an
 * unnamed failure and says so — guessing a cause the server did not report
 * would be worse than admitting the response was not understood.
 */
const SERVER_ERROR_KEYS: Record<string, string> = {
  idempotency_conflict: 'delivery_os.project.import.error.idempotencyConflict',
  foreign_reference: 'delivery_os.project.import.error.foreignProject',
  unsupported_schema_version: 'delivery_os.project.import.error.unsupportedSchemaVersion',
  payload_too_large: 'delivery_os.project.import.error.payloadTooLarge',
  forbidden: 'delivery_os.project.import.error.forbidden',
  not_found: 'delivery_os.project.import.error.notFound',
  missing_acceptance_criteria: 'delivery_os.project.import.error.missingAcceptanceCriteria',
  validation_failed: 'delivery_os.project.import.error.validationFailed',
  optimistic_lock_required: 'delivery_os.project.import.error.lockRequired',
}

export function ProposalImportDialog({
  open,
  onOpenChange,
  variant = 'requirements',
  projectId,
  projectUpdatedAt,
  onImported,
}: ProposalImportDialogProps) {
  const t = useT()
  const [raw, setRaw] = React.useState('')
  const [problem, setProblem] = React.useState<ClientProblem | null>(null)
  const [serverError, setServerError] = React.useState<string | null>(null)
  const [serverIssues, setServerIssues] = React.useState<ProposalIssue[]>([])
  const [submitting, setSubmitting] = React.useState(false)
  const [drafting, setDrafting] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: MUTATION_CONTEXT_ID })

  React.useEffect(() => {
    setRaw('')
    setProblem(null)
    setServerError(null)
    setServerIssues([])
  }, [open, variant])

  /** Drafts the plan from the active baseline with the connected agent; the operator still reviews and imports it. */
  const draftPlan = React.useCallback(async () => {
    setDrafting(true)
    setProblem(null)
    setServerError(null)
    setServerIssues([])
    try {
      const response = await apiCall<unknown>(`/api/delivery_os/projects/${encodeURIComponent(projectId)}/plan-draft`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      const proposal = (response.result as { proposal?: unknown } | null)?.proposal
      if (!response.ok || !proposal) {
        setServerError(t('delivery_os.project.import.plan.draftFailed'))
        return
      }
      setRaw(JSON.stringify(proposal, null, 2))
      const uncovered = (response.result as { uncoveredAcIds?: string[] } | null)?.uncoveredAcIds ?? []
      if (uncovered.length > 0) flash(t('delivery_os.project.import.plan.uncovered', { ids: uncovered.join(', ') }), 'warning')
    } catch {
      setServerError(t('delivery_os.project.import.plan.draftFailed'))
    } finally {
      setDrafting(false)
    }
  }, [projectId, t])

  const parsed = React.useMemo(() => {
    if (raw.trim().length === 0) return null
    return variant === 'plan' ? parsePlanProposal(raw) : parseRequirementsProposal(raw)
  }, [raw, variant])

  const requirementsSummary = parsed?.ok && variant === 'requirements'
    ? summarizeRequirementsProposal(parsed.manifest as Parameters<typeof summarizeRequirementsProposal>[0])
    : null
  const planSummary = parsed?.ok && variant === 'plan'
    ? summarizePlanProposal(parsed.manifest as Parameters<typeof summarizePlanProposal>[0])
    : null

  const submit = React.useCallback(async () => {
    setServerError(null)
    setServerIssues([])
    const result = variant === 'plan' ? parsePlanProposal(raw) : parseRequirementsProposal(raw)
    if (!result.ok) {
      setProblem(
        result.reason === 'empty' ? { kind: 'empty' }
          : result.reason === 'too_large' ? { kind: 'tooLarge', length: result.length }
          : result.reason === 'not_json' ? { kind: 'notJson' }
          : result.reason === 'not_object' ? { kind: 'notObject' }
          : { kind: 'schema', issues: result.issues },
      )
      return
    }
    if (!manifestTargetsProject(result.manifest.projectId, projectId)) {
      setProblem({ kind: 'foreignProject' })
      return
    }
    setProblem(null)
    setSubmitting(true)
    try {
      const call = await runMutation({
        operation: async () => {
          const path = variant === 'plan'
            ? `/api/delivery_os/projects/${encodeURIComponent(projectId)}/tasks`
            : `/api/delivery_os/projects/${encodeURIComponent(projectId)}/baselines`
          const source = variant === 'plan' ? 'plan_proposal' : 'requirements_proposal'
          const response = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(projectUpdatedAt),
            () => apiCall<unknown>(path, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ source, manifest: result.manifest }),
            }),
          )
          if (!response.ok) {
            throw Object.assign(new Error('[internal] delivery_os proposal import failed'), {
              status: response.status,
              ...((response.result as Record<string, unknown> | null) ?? {}),
            })
          }
          return response
        },
        context: {
          formId: MUTATION_CONTEXT_ID,
          resourceKind: 'delivery_os.project',
          resourceId: projectId,
          retryLastMutation,
        },
        mutationPayload: { manifestId: result.manifest.manifestId },
      })
      const body = variant === 'plan'
        ? planImportResponseSchema.safeParse(call.result)
        : baselineCreateResponseSchema.safeParse(call.result)
      if (!body.success) {
        setServerError(t('delivery_os.project.import.error.unreadableResponse'))
        return
      }
      // A replay is a success, not a failure: the same manifest content under the
      // same id was already imported, so nothing was written and nothing is wrong.
      // The plan case adds a second fact the operator cannot be left to infer —
      // the merged baseline is NOT active and needs two decisions of its own.
      flash(
        variant === 'plan'
          ? body.data.duplicate
            ? t('delivery_os.project.import.plan.duplicate', { version: body.data.version })
            : t('delivery_os.project.import.plan.created', {
                version: body.data.version,
                count: 'tasks' in body.data ? body.data.tasks.length : 0,
              })
          : body.data.duplicate
            ? t('delivery_os.project.import.requirements.duplicate', { version: body.data.version })
            : t('delivery_os.project.import.requirements.created', { version: body.data.version }),
        body.data.duplicate ? 'info' : 'success',
      )
      onImported(body.data.projectUpdatedAt)
      onOpenChange(false)
    } catch (error) {
      if (surfaceRecordConflict(error, t, { title: t('delivery_os.project.import.error.conflictTitle') })) return
      const parsedBody = deliveryErrorBodySchema.safeParse(error)
      if (parsedBody.success && parsedBody.data.details.length > 0) {
        setServerIssues(parsedBody.data.details.map((detail) => ({
          path: detail.path ?? '',
          code: detail.code,
          message: detail.message ?? '',
        })))
      }
      const code = (error as { code?: unknown } | null)?.code
      const key = typeof code === 'string'
        ? (variant === 'plan' ? PLAN_ERROR_KEYS[code] : undefined) ?? SERVER_ERROR_KEYS[code]
        : undefined
      setServerError(key ? t(key) : t('delivery_os.project.import.error.unnamed'))
    } finally {
      setSubmitting(false)
    }
  }, [onImported, onOpenChange, projectId, projectUpdatedAt, raw, retryLastMutation, runMutation, t, variant])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void submit()
    }
  }, [submit])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="proposal-import-dialog">
        <DialogHeader>
          <DialogTitle>{t(`delivery_os.project.import.${variant}.title`)}</DialogTitle>
          <DialogDescription>{t(`delivery_os.project.import.${variant}.description`)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {variant === 'plan' ? (
            <Button type="button" variant="outline" disabled={drafting || submitting} onClick={() => { void draftPlan() }}>
              {t(drafting ? 'delivery_os.project.import.plan.drafting' : 'delivery_os.project.import.plan.draft')}
            </Button>
          ) : null}
          <Textarea
            data-testid="proposal-import-textarea"
            aria-label={t('delivery_os.project.import.manifestLabel')}
            value={raw}
            rows={12}
            className="font-mono text-xs"
            onChange={(event) => { setRaw(event.target.value); setProblem(null); setServerError(null); setServerIssues([]) }}
            onKeyDown={handleKeyDown}
          />
          <p className="text-xs text-muted-foreground" data-testid="proposal-import-counter">
            {t('delivery_os.project.import.charCount', { count: raw.trim().length, limit: MAX_MANIFEST_BODY_CHARS })}
          </p>
          {requirementsSummary ? <RequirementsProposalPreview summary={requirementsSummary} /> : null}
          {planSummary ? <PlanProposalPreview summary={planSummary} /> : null}
          {problem?.kind === 'schema' ? (
            <ProposalIssueList issues={problem.issues} label={t('delivery_os.project.import.error.schema')} />
          ) : null}
          {problem && problem.kind !== 'schema' ? (
            <p data-testid="proposal-import-problem" className="text-sm text-status-error-text">
              {problem.kind === 'empty' ? t('delivery_os.project.import.error.empty')
                : problem.kind === 'notJson' ? t('delivery_os.project.import.error.notJson')
                : problem.kind === 'notObject' ? t('delivery_os.project.import.error.notObject')
                : problem.kind === 'foreignProject' ? t('delivery_os.project.import.error.foreignProject')
                : t('delivery_os.project.import.error.tooLarge', { length: problem.length, limit: MAX_MANIFEST_BODY_CHARS })}
            </p>
          ) : null}
          {serverError ? (
            <p data-testid="proposal-import-server-error" className="text-sm text-status-error-text">{serverError}</p>
          ) : null}
          {serverIssues.length > 0 ? (
            <ProposalIssueList issues={serverIssues} label={t('delivery_os.project.import.error.serverDetails')} />
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('delivery_os.project.import.cancel')}
          </Button>
          <Button type="button" disabled={submitting} onClick={() => void submit()} data-testid="proposal-import-submit">
            {t('delivery_os.project.import.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
