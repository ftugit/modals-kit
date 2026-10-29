// Описание встраиваемой формы блокировок (`blocksForm`): наложение
// (сфера + причина + срок) и снятие (id записи кнопкой). Срок — чекбокс
// «навсегда» или поле даты; JS-длительность в компоненте только меняет
// поле даты, серверу едут дата и чекбокс. Работает с JS и без JS.
import { defineForm, field, v } from '#lib/form/index.js'
import { AUTH_MESSAGES, PROFILE_MESSAGES } from '../../messages.js'
import { BLOCK_SCOPES, specBlocks, type BlockScope } from '../../spec-block.js'

export const BLOCKS_FORM_ID = 'user-profile-blocks'

const SCOPES = Object.keys(BLOCK_SCOPES) as BlockScope[]

export const blocksForm = defineForm({
  id: BLOCKS_FORM_ID,
  revision: 1,
  messages: { ...AUTH_MESSAGES, ...PROFILE_MESSAGES },
  actions: [
    { id: 'add', label: specBlocks.addButton, validate: 'full' },
    { id: 'lift', label: specBlocks.liftButton, validate: 'none' },
  ],
  fields: {
    scope: field.radio({
      label: specBlocks.scopeLabel,
      defaultValue: 'auth',
      options: SCOPES.map((value) => ({
        value,
        label: `${BLOCK_SCOPES[value].title} — ${BLOCK_SCOPES[value].description}`,
      })),
    }),
    reason: field.text({
      label: specBlocks.reasonLabel,
      help: specBlocks.reasonHelp,
      validate: [v.minLength(1), v.maxLength(200)],
    }),
    forever: field.checkbox({
      label: specBlocks.foreverLabel,
      defaultValue: true,
    }),
    until: field['datetime-local']({
      label: specBlocks.untilLabel,
    }),
    // JS-подсказка срока: сервер поля игнорирует, истина — дата и чекбокс.
    dur_n: field.number({ label: 'Длительность' }),
    dur_unit: field.select({
      label: 'Отсечка',
      options: [
        { value: 'minutes', label: 'минуты' },
        { value: 'hours', label: 'часы' },
        { value: 'days', label: 'дни' },
        { value: 'weeks', label: 'недели' },
        { value: 'months', label: 'месяцы' },
        { value: 'years', label: 'годы' },
      ],
    }),
    // Цель и снимаемая запись: скрытые адреса, права перепроверяет домен.
    subject: field.text({}),
    block_id: field.text({}),
  },
})
