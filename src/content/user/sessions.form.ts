/**
 * Отзыв своих устройств. Описание общее для экрана и экшена: без JS это
 * обычный POST, идентификатор едет скрытым полем, не адресом.
 */
import { defineForm, field, v } from '#lib/form/index.js'

export const SESSION_REVOKE_FORM_ID = 'user-session-revoke'
export const SESSION_REVOKE_OTHERS_FORM_ID = 'user-session-revoke-others'

/** Одна сессия. `id` — публичный идентификатор строки, не `jti`. */
export function sessionRevokeForm(id: string) {
  return defineForm({
    id: SESSION_REVOKE_FORM_ID,
    revision: 1,
    fields: {
      id: field.hidden({
        defaultValue: id,
        validate: [v.required(), v.maxLength(36)],
      }),
    },
  })
}

/** Все свои, кроме текущей. Намерение задаёт экшен `?/others`, не поле. */
export function sessionRevokeOthersForm() {
  return defineForm({
    id: SESSION_REVOKE_OTHERS_FORM_ID,
    revision: 1,
    fields: {
      scope: field.hidden({
        defaultValue: 'others',
        validate: [v.required()],
      }),
    },
  })
}
