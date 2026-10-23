import type { Component } from 'svelte'
import { describe, expect, it } from 'vitest'
import { BUILTIN_TYPES } from '#lib/form/index.js'
import AutoTextareaField from './AutoTextareaField.svelte'
import CheckboxField from './CheckboxField.svelte'
import FileField from './FileField.svelte'
import HiddenField from './HiddenField.svelte'
import NumberField from './NumberField.svelte'
import OtpField from './OtpField.svelte'
import PasswordField from './PasswordField.svelte'
import PasswordStrengthField from './PasswordStrengthField.svelte'
import PhoneField from './PhoneField.svelte'
import RadioGroupField from './RadioGroupField.svelte'
import RangeField from './RangeField.svelte'
import RatingField from './RatingField.svelte'
import { resolve } from './resolve.js'
import SearchField from './SearchField.svelte'
import SelectField from './SelectField.svelte'
import SwitchField from './SwitchField.svelte'
import TextareaField from './TextareaField.svelte'
import TextField from './TextField.svelte'

const EXPECTED_NON_TEXT: Record<string, Component<never>> = {
  radio: RadioGroupField as unknown as Component<never>,
  select: SelectField as unknown as Component<never>,
  multiselect: SelectField as unknown as Component<never>,
  checkbox: CheckboxField as unknown as Component<never>,
  switch: SwitchField as unknown as Component<never>,
  range: RangeField as unknown as Component<never>,
  number: NumberField as unknown as Component<never>,
  search: SearchField as unknown as Component<never>,
  otp: OtpField as unknown as Component<never>,
  password: PasswordField as unknown as Component<never>,
  textarea: TextareaField as unknown as Component<never>,
  file: FileField as unknown as Component<never>,
  files: FileField as unknown as Component<never>,
  photo: FileField as unknown as Component<never>,
  hidden: HiddenField as unknown as Component<never>,
}

const EXPECTED_TEXT_MODES = new Set(['text', 'email', 'tel', 'url', 'date', 'time', 'datetime-local', 'color'])

describe('form component resolver (F9 contract)', () => {
  it('maps every InputMode declared across BUILTIN_TYPES without accidental fallback to TextField', () => {
    for (const def of BUILTIN_TYPES) {
      for (const mode of def.inputs) {
        if (mode === 'fields') continue // `field.fields` рендерится конструктором `SchemaBuilder`
        const picked = resolve({ input: mode })
        if (mode in EXPECTED_NON_TEXT) {
          expect(picked, `${def.kind}:${mode}`).toBe(EXPECTED_NON_TEXT[mode])
        } else {
          expect(EXPECTED_TEXT_MODES.has(mode), `unhandled InputMode "${mode}" in ${def.kind}`).toBe(true)
          expect(picked, `${def.kind}:${mode}`).toBe(TextField)
        }
      }
    }
  })

  it('supports field variants and custom app field types', () => {
    expect(resolve({ input: 'password', variant: 'strength' })).toBe(PasswordStrengthField)
    expect(resolve({ input: 'textarea', variant: 'auto' })).toBe(AutoTextareaField)
    expect(resolve({ input: 'phone' })).toBe(PhoneField)
    expect(resolve({ input: 'rating' })).toBe(RatingField)
  })
})
