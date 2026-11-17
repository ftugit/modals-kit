// Расширение входа: модуль профиля сам объявляет свой шаг.
// Файл подхватывается glob'ом `/src/modules/**/auth.ext.ts` в layout сайта.
import { registerAuthStep } from '#modules/user/base/svelte/auth-extensions.js'
import { DEFAULT_PROFILE_LIMITS } from './profile-form/index.js'
import AuthProfileStep from './AuthProfileStep.svelte'

registerAuthStep({
  id: 'profile',
  component: AuthProfileStep,
  defaultLimits: { ...DEFAULT_PROFILE_LIMITS },
})
