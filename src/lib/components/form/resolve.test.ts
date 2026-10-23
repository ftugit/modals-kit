import { describe, expect, it } from 'vitest'
import { builtinTypes } from '#lib/form/index.js'
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

describe('form component resolver (F9 contract)', () => {
  it('resolves every builtin #lib/form input mode to its dedicated UI component without accidental Select/Input fallbacks', () => {
    expect(resolve({ input: builtinTypes.radio.input })).toBe(RadioGroupField)
    expect(resolve({ input: builtinTypes.select.input })).toBe(SelectField)
    expect(resolve({ input: builtinTypes.multiselect.input })).toBe(SelectField)
    expect(resolve({ input: builtinTypes.checkbox.input })).toBe(CheckboxField)
    expect(resolve({ input: builtinTypes.switch.input })).toBe(SwitchField)
    expect(resolve({ input: builtinTypes.range.input })).toBe(RangeField)
    expect(resolve({ input: builtinTypes.number.input })).toBe(NumberField)
    expect(resolve({ input: builtinTypes.search.input })).toBe(SearchField)
    expect(resolve({ input: builtinTypes.otp.input })).toBe(OtpField)
    expect(resolve({ input: builtinTypes.password.input })).toBe(PasswordField)
    expect(resolve({ input: builtinTypes.password.input, variant: 'strength' })).toBe(PasswordStrengthField)
    expect(resolve({ input: builtinTypes.textarea.input })).toBe(TextareaField)
    expect(resolve({ input: builtinTypes.textarea.input, variant: 'auto' })).toBe(AutoTextareaField)
    expect(resolve({ input: builtinTypes.file.input })).toBe(FileField)
    expect(resolve({ input: builtinTypes.files.input })).toBe(FileField)
    expect(resolve({ input: builtinTypes.photo.input })).toBe(FileField)
    expect(resolve({ input: builtinTypes.hidden.input })).toBe(HiddenField)
    expect(resolve({ input: 'phone' })).toBe(PhoneField)
    expect(resolve({ input: 'rating' })).toBe(RatingField)

    for (const textLike of ['text', 'email', 'url', 'date', 'time', 'datetime', 'slug', 'username', 'tag', 'tags'] as const) {
      expect(resolve({ input: builtinTypes[textLike].input })).toBe(TextField)
    }
  })

  it('covers 100% of keys in builtinTypes', () => {
    for (const [key, def] of Object.entries(builtinTypes)) {
      const component = resolve({ input: def.input })
      expect(component, `builtinTypes.${key} (${def.input}) must resolve to a component`).toBeTruthy()
    }
  })
})
