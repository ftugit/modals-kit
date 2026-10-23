// Выбор компонента поля по представлению — код приложения, один раз на проект.
// Отдельно от настройки форм (`forms.config.ts`): `Field` нужен только этот выбор,
// а не транспорт, свои типы и асинхронные проверки — страница, где форма лишь
// показывает поля (фильтры каталога), не тянет их в сборку.
import { createConfig } from '#lib/form/svelte/index.js'
import CheckboxField from './CheckboxField.svelte'
import FileField from './FileField.svelte'
import HiddenField from './HiddenField.svelte'
import RadioGroupField from './RadioGroupField.svelte'
import RangeField from './RangeField.svelte'
import RatingField from './RatingField.svelte'
import PhoneField from './PhoneField.svelte'
import SelectField from './SelectField.svelte'
import PasswordField from './PasswordField.svelte'
import PasswordStrengthField from './PasswordStrengthField.svelte'
import NumberField from './NumberField.svelte'
import OtpField from './OtpField.svelte'
import SearchField from './SearchField.svelte'
import SwitchField from './SwitchField.svelte'
import TextField from './TextField.svelte'
import TextareaField from './TextareaField.svelte'
import AutoTextareaField from './AutoTextareaField.svelte'

export const resolve = (f: { input: string; variant?: string }) => {
  switch (f.input) {
    // Вариант из описания поля выбирает примитив: шкала сложности или просто глаз,
    // поле по высоте текста или обычное.
    case 'password': return f.variant === 'strength' ? PasswordStrengthField : PasswordField
    case 'rating': return RatingField          // свой тип — такой же гражданин
    case 'phone': return PhoneField            // и второй: номер одной строкой
    case 'textarea': return f.variant === 'auto' ? AutoTextareaField : TextareaField
    case 'radio': return RadioGroupField
    case 'select': case 'multiselect': return SelectField
    case 'checkbox': return CheckboxField
    case 'file': case 'files': case 'photo': return FileField
    case 'range': return RangeField
    case 'hidden': return HiddenField          // без подписи и обёртки: поля не видно
    case 'switch': return SwitchField
    case 'number': return NumberField
    case 'search': return SearchField
    case 'otp': return OtpField
    default: return TextField
  }
}

/** Только выбор компонента: то, что нужно `Field`. */
export const fieldViews = createConfig({ resolve })
