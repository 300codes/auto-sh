'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import type { CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import {
  DeliveryProjectForm,
  type DeliveryProjectFormValues,
} from '@open-mercato/core/modules/delivery_os/components/projects/DeliveryProjectForm'
import { projectCreateResponseSchema } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { DEFAULT_DELIVERY_LIMITS } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { TARGET_PROFILES } from '@open-mercato/core/modules/delivery_os/lib/targetProfiles'

const LIST_HREF = '/backend/delivery/projects'

function encodeProfile(id: string, version: number): string {
  return `${id}@${version}`
}

const DEFAULT_PROFILE = TARGET_PROFILES[0]

export default function CreateDeliveryProjectPage() {
  const t = useT()
  const router = useRouter()

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'name',
      label: t('delivery_os.projects.form.fields.name'),
      type: 'text',
      required: true,
      maxLength: 200,
      placeholder: t('delivery_os.projects.form.placeholders.name'),
    },
    {
      id: 'inputMode',
      label: t('delivery_os.projects.form.fields.inputMode'),
      type: 'select',
      required: true,
      description: t('delivery_os.projects.form.help.inputMode'),
      options: [
        { value: 'from_brief', label: t('delivery_os.projects.inputMode.from_brief') },
        { value: 'from_design', label: t('delivery_os.projects.inputMode.from_design') },
      ],
    },
    {
      id: 'targetProfile',
      label: t('delivery_os.projects.form.fields.targetProfile'),
      type: 'select',
      required: true,
      description: t('delivery_os.projects.form.help.targetProfile'),
      options: TARGET_PROFILES.map((profile) => ({
        value: encodeProfile(profile.id, profile.version),
        label: `${profile.label} (v${profile.version})`,
      })),
    },
    {
      id: 'repositoryRef',
      label: t('delivery_os.projects.form.fields.repositoryRef'),
      type: 'text',
      maxLength: 300,
      description: t('delivery_os.projects.form.help.repositoryRef'),
    },
    {
      id: 'brief',
      label: t('delivery_os.projects.form.fields.brief'),
      type: 'textarea',
      rows: 8,
      maxLength: 20000,
      showCount: true,
      layout: 'full',
    },
    {
      id: 'maxParallelTasks',
      label: t('delivery_os.projects.form.fields.maxParallelTasks'),
      type: 'number',
      required: true,
    },
    {
      id: 'maxCorrectionRounds',
      label: t('delivery_os.projects.form.fields.maxCorrectionRounds'),
      type: 'number',
      required: true,
    },
    {
      id: 'attemptTimeoutMinutes',
      label: t('delivery_os.projects.form.fields.attemptTimeoutMinutes'),
      type: 'number',
      required: true,
    },
  ], [t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      title: t('delivery_os.projects.form.groups.details'),
      column: 1,
      fields: ['name', 'inputMode', 'targetProfile', 'repositoryRef', 'brief'],
    },
    {
      id: 'limits',
      title: t('delivery_os.projects.form.groups.limits'),
      column: 2,
      fields: ['maxParallelTasks', 'maxCorrectionRounds', 'attemptTimeoutMinutes'],
    },
  ], [t])

  const initialValues = React.useMemo<Partial<DeliveryProjectFormValues>>(() => ({
    name: '',
    inputMode: 'from_brief',
    targetProfile: DEFAULT_PROFILE ? encodeProfile(DEFAULT_PROFILE.id, DEFAULT_PROFILE.version) : '',
    repositoryRef: '',
    brief: '',
    maxParallelTasks: DEFAULT_DELIVERY_LIMITS.maxParallelTasks,
    maxCorrectionRounds: DEFAULT_DELIVERY_LIMITS.maxCorrectionRounds,
    attemptTimeoutMinutes: DEFAULT_DELIVERY_LIMITS.attemptTimeoutMinutes,
  }), [])

  const handleSubmit = React.useCallback(async (values: DeliveryProjectFormValues) => {
    const [targetProfileId, rawVersion] = String(values.targetProfile ?? '').split('@')
    const targetProfileVersion = Number(rawVersion)
    if (!targetProfileId || !Number.isInteger(targetProfileVersion) || targetProfileVersion <= 0) {
      throw createCrudFormError(t('delivery_os.projects.form.errors.targetProfile'), {
        targetProfile: t('delivery_os.projects.form.errors.targetProfile'),
      })
    }
    const brief = String(values.brief ?? '').trim()
    const repositoryRef = String(values.repositoryRef ?? '').trim()
    const call = await createCrud<unknown>('delivery_os/projects', {
      name: String(values.name ?? '').trim(),
      inputMode: values.inputMode,
      targetProfileId,
      targetProfileVersion,
      brief: brief.length > 0 ? brief : null,
      repositoryRef: repositoryRef.length > 0 ? repositoryRef : null,
      limits: {
        maxParallelTasks: Number(values.maxParallelTasks),
        maxCorrectionRounds: Number(values.maxCorrectionRounds),
        attemptTimeoutMinutes: Number(values.attemptTimeoutMinutes),
      },
    })
    const created = projectCreateResponseSchema.safeParse(call.result)
    if (!created.success) throw createCrudFormError(t('delivery_os.projects.form.errors.createResponse'))
    router.push(`/backend/delivery/projects/${created.data.id}`)
  }, [router, t])

  return (
    <Page>
      <PageBody>
        <DeliveryProjectForm
          title={t('delivery_os.projects.form.createTitle')}
          submitLabel={t('delivery_os.projects.form.submitCreate')}
          backHref={LIST_HREF}
          cancelHref={LIST_HREF}
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
