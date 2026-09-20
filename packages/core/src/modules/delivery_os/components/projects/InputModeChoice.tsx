'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { RadioGroup } from '@open-mercato/ui/primitives/radio'
import { RadioField } from '@open-mercato/ui/primitives/radio-field'

export const INPUT_MODE_VALUES = ['from_brief', 'from_design'] as const

export type InputModeValue = (typeof INPUT_MODE_VALUES)[number]

export function InputModeChoice({ id, value, disabled, setValue }: {
  id: string
  value: unknown
  disabled?: boolean
  setValue: (next: unknown) => void
}) {
  const t = useT()
  const selected = INPUT_MODE_VALUES.find((candidate) => candidate === value) ?? INPUT_MODE_VALUES[0]
  return (
    <RadioGroup
      value={selected}
      onValueChange={(next) => setValue(next)}
      disabled={disabled}
      aria-label={t('delivery_os.projects.form.fields.inputMode')}
      className="gap-3"
    >
      {INPUT_MODE_VALUES.map((mode) => (
        <RadioField
          key={mode}
          id={`${id}-${mode}`}
          value={mode}
          data-testid={`input-mode-${mode}`}
          label={t(`delivery_os.projects.inputMode.${mode}`)}
          description={t(`delivery_os.projects.form.inputMode.consequence.${mode}`)}
          containerClassName="rounded-md border border-border p-3"
        />
      ))}
    </RadioGroup>
  )
}

export default InputModeChoice
