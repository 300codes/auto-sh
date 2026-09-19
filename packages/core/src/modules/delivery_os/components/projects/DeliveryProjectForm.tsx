'use client'

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'

export type DeliveryProjectFormValues = Record<string, unknown> & {
  name: string
  inputMode: string
  brief: string
  targetProfile: string
  repositoryRef: string
  maxParallelTasks: number
  maxCorrectionRounds: number
  attemptTimeoutMinutes: number
}

export type DeliveryProjectFormProps = {
  title: string
  submitLabel: string
  backHref: string
  cancelHref: string
  successRedirect?: string
  fields: CrudField[]
  groups?: CrudFormGroup[]
  initialValues: Partial<DeliveryProjectFormValues>
  onSubmit: (values: DeliveryProjectFormValues) => Promise<void>
  optimisticLockUpdatedAt?: string | null
}

/**
 * Mode-agnostic project form shell. It owns no field list, no API path and no
 * knowledge of create vs edit: a host page supplies `fields`, `initialValues`
 * and `onSubmit`, so an edit host can reuse it by passing the update schema's
 * fields and `initialValues.updatedAt` without touching this file.
 */
export function DeliveryProjectForm({
  title,
  submitLabel,
  backHref,
  cancelHref,
  successRedirect,
  fields,
  groups,
  initialValues,
  onSubmit,
  optimisticLockUpdatedAt,
}: DeliveryProjectFormProps) {
  return (
    <CrudForm<DeliveryProjectFormValues>
      title={title}
      titleHeadingLevel={1}
      backHref={backHref}
      cancelHref={cancelHref}
      successRedirect={successRedirect}
      submitLabel={submitLabel}
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      optimisticLockUpdatedAt={optimisticLockUpdatedAt}
      onSubmit={onSubmit}
    />
  )
}

export default DeliveryProjectForm
