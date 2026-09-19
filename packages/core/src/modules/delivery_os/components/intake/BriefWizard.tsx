'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { intakeResponseSchema, intakeStepSchema, intakeUpdateRequestSchema, type IntakeResponse } from '../../lib/contracts'
import { useFlowQuery } from '../detail/useFlowQuery'
import { ScopingConversation } from './ScopingConversation'

const TEXT_FIELDS = ['businessGoal', 'audience', 'problem', 'content'] as const
const LIST_FIELDS = ['features', 'integrations', 'constraints', 'inspirations', 'unknowns'] as const
const lines = (value: unknown) => String(value ?? '').split('\n').map((line) => line.trim()).filter(Boolean)

type Props = { projectId: string; projectUpdatedAt: string; actorUserId: string | null; canManage: boolean; canImport: boolean; onChanged: () => void }

function IntakeEditor({ response, actorUserId, onSaved }: { response: IntakeResponse; actorUserId: string | null; onSaved: () => Promise<void> }) {
  const t = useT()
  const intake = response.intake
  const fields = React.useMemo<CrudField[]>(() => [
    ...(intake.step === 'brief' || intake.step === 'review' ? TEXT_FIELDS : []).map((id): CrudField => ({ id, label: t(`delivery_os.flow.brief.${id}`), type: 'textarea', rows: 3 })),
    ...(intake.step === 'brief' || intake.step === 'review' ? LIST_FIELDS : []).map((id): CrudField => ({ id, label: t(`delivery_os.flow.brief.${id}`), type: 'textarea', rows: 3, description: t('delivery_os.flow.onePerLine') })),
    ...(intake.step === 'scoping' || intake.step === 'review' ? intake.questions : []).map((question): CrudField => ({ id: `answer_${question.id}`, label: question.text, type: 'textarea', rows: 2, description: question.blocking ? t('delivery_os.flow.blockingQuestion') : undefined })),
    { id: 'confirmPlatform', label: t('delivery_os.flow.confirmPlatform', { profile: response.targetProfile.profileId }), type: 'checkbox' },
    { id: 'confirmManualTools', label: t('delivery_os.flow.confirmManualTools'), type: 'checkbox', description: t('delivery_os.flow.manualToolsHint') },
    { id: 'step', label: t('delivery_os.flow.step'), type: 'select', options: intakeStepSchema.options.slice(0, intakeStepSchema.options.indexOf(intake.step) + 2).map((step) => ({ value: step, label: t(`delivery_os.flow.step.${step}`) })) },
  ], [intake, response.targetProfile, t])
  const initialValues = React.useMemo(() => ({
    updatedAt: response.updatedAt,
    ...Object.fromEntries(TEXT_FIELDS.map((id) => [id, intake.brief[id] ?? ''])),
    ...Object.fromEntries(LIST_FIELDS.map((id) => [id, intake.brief[id].join('\n')])),
    ...Object.fromEntries(intake.questions.map((question) => [`answer_${question.id}`, question.answer?.text ?? ''])),
    confirmPlatform: intake.platform.chosen !== null,
    confirmManualTools: intake.tools.some((tool) => tool.stageId === 'ux' && tool.kind === 'design' && tool.ref === 'manual_upload')
      && intake.tools.some((tool) => tool.stageId === 'implementation' && tool.kind === 'execution' && tool.ref === 'manual_handoff'),
    step: intake.step,
  }), [intake, response.updatedAt])
  const save = async (values: Record<string, unknown>) => {
    if (values.confirmPlatform && !actorUserId) throw createCrudFormError(t('delivery_os.flow.actorMissing'))
    const chosen = values.confirmPlatform ? intake.platform.chosen ?? { ...response.targetProfile, chosenBy: actorUserId, chosenAt: new Date().toISOString() } : null
    const parsed = intakeUpdateRequestSchema.safeParse({
      ...intake,
      step: values.step,
      brief: { ...intake.brief, ...Object.fromEntries(TEXT_FIELDS.map((id) => [id, String(values[id] ?? '').trim() || null])), ...Object.fromEntries(LIST_FIELDS.map((id) => [id, lines(values[id])])) },
      questions: intake.questions.map((question) => { const answer = String(values[`answer_${question.id}`] ?? '').trim(); return { ...question, answer: answer ? { text: answer, answeredAt: question.answer?.text === answer ? question.answer.answeredAt : new Date().toISOString() } : null } }),
      platform: { ...intake.platform, chosen },
      tools: Boolean(values.confirmManualTools) === initialValues.confirmManualTools ? intake.tools : values.confirmManualTools ? [
        ...intake.tools.filter((tool) => !(tool.stageId === 'ux' && tool.kind === 'design') && !(tool.stageId === 'implementation' && tool.kind === 'execution')),
        { stageId: 'ux', kind: 'design', ref: 'manual_upload', rationale: null },
        { stageId: 'implementation', kind: 'execution', ref: 'manual_handoff', rationale: null },
      ] : intake.tools.filter((tool) => tool.ref !== 'manual_upload' && tool.ref !== 'manual_handoff'),
    })
    if (!parsed.success) throw createCrudFormError(t('delivery_os.flow.invalid'))
    await withScopedApiRequestHeaders(buildOptimisticLockHeader(response.updatedAt), () => apiCallOrThrow(`/api/delivery_os/projects/${intake.projectId}/intake`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(parsed.data) }))
    await onSaved()
  }
  return <CrudForm key={response.updatedAt} embedded entityId="delivery_os:intake" fields={fields} initialValues={initialValues} submitLabel={t('delivery_os.flow.save')} onSubmit={save} />
}

export function BriefWizard({ projectId, projectUpdatedAt, actorUserId, canManage, canImport, onChanged }: Props) {
  const t = useT()
  const query = useFlowQuery(`/api/delivery_os/projects/${projectId}/intake`, intakeResponseSchema)
  const saved = React.useCallback(async () => { await query.reload(); onChanged() }, [query.reload, onChanged])
  if (!query.data && query.loading) return <LoadingMessage label={t('delivery_os.flow.loading')} />
  if (query.error || !query.data || query.data.intake.projectId !== projectId) return <ErrorMessage label={t('delivery_os.flow.loadError')} action={<Button type="button" onClick={() => void query.reload()}>{t('delivery_os.task.retry')}</Button>} />
  return <section id="delivery-intake" className="space-y-4" data-testid="delivery-brief-wizard">
    <h2 className="text-lg font-semibold">{t('delivery_os.flow.brief.title')}</h2>
    <p>{t(`delivery_os.flow.step.${query.data.intake.step}`)}</p>
    {canManage ? <IntakeEditor response={query.data} actorUserId={actorUserId} onSaved={saved} /> : <p>{query.data.intake.brief.businessGoal}</p>}
    <ScopingConversation response={query.data} projectUpdatedAt={projectUpdatedAt} canManage={canManage} canImport={canImport} onSaved={saved} />
  </section>
}
