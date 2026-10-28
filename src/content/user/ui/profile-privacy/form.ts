// Описание встраиваемой формы приватности профиля (`privacyForm`): один
// выбор уровня видимости. Варианты — спека профиля (`specProfile`), список
// сам ограничивает значение (oneOf встроенного select): уровень не из
// каталога формой не пройдёт. Работает идентично с JS и без JS.
import { defineForm, field } from '#lib/form/index.js'
import { AUTH_MESSAGES, PROFILE_MESSAGES } from '../../messages.js'
import { specProfile } from '../../spec-profile.js'
import type { VisibilityLevel } from '../../types.js'

export const PRIVACY_FORM_ID = 'user-profile-privacy'

const LEVELS: readonly VisibilityLevel[] = ['all', 'users', 'nobody']

export const privacyForm = defineForm({
  id: PRIVACY_FORM_ID,
  revision: 1,
  messages: { ...AUTH_MESSAGES, ...PROFILE_MESSAGES },
  actions: [{ id: 'privacy', label: 'Сохранить', validate: 'full' }],
  fields: {
    level: field.radio({
      label: specProfile.privacyTitle,
      defaultValue: 'nobody',
      options: LEVELS.map((v) => ({ value: v, label: specProfile.privacyLevels[v] })),
    }),
  },
})
