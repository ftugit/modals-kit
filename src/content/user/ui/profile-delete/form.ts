// Описание формы удаления профиля (`profileDeleteForm`): цель скрытым полем
// и, при праве, чекбокс «также удалить seed-аккаунт». Права и запреты цели
// перепроверяет сервер при отправке — форма только собирает намерение.
import { defineForm, field } from '#lib/form/index.js'
import { AUTH_MESSAGES, PROFILE_MESSAGES } from '../../messages.js'

export const PROFILE_DELETE_FORM_ID = 'user-profile-delete'

export const profileDeleteForm = defineForm({
  id: PROFILE_DELETE_FORM_ID,
  revision: 1,
  messages: { ...AUTH_MESSAGES, ...PROFILE_MESSAGES },
  actions: [{ id: 'delete', label: 'Удалить', validate: 'full' }],
  fields: {
    /** Чей профиль удаляем: приходит из разметки экрана, не из адреса. */
    subject: field.hidden({ label: 'Аккаунт' }),
    /** Вместе с профилем пометить на удаление и seed-аккаунт цели. */
    with_seed: field.checkbox({
      label: 'Также удалить seed-аккаунт',
      defaultValue: false,
    }),
  },
})
