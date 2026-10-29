import { defineForm, field } from '#lib/form/index.js'
import { AUTH_MESSAGES, PROFILE_MESSAGES } from '../../messages.js'

export const BLOCK_DELETE_FORM_ID = 'user-block-delete'

export const blockDeleteForm = defineForm({
  id: BLOCK_DELETE_FORM_ID,
  revision: 1,
  messages: { ...AUTH_MESSAGES, ...PROFILE_MESSAGES },
  actions: [{ id: 'delete', label: 'Удалить', validate: 'none' }],
  fields: {
    block_id: field.hidden({ defaultValue: '' }),
    subject: field.hidden({ defaultValue: '' }),
    hard: field.checkbox({
      label: 'Удалить окончательно из базы данных (без возможности восстановления)',
      defaultValue: false,
    }),
  },
})
