import { defineForm, field, v } from '#lib/form/index.js'
import { AUTH_MESSAGES, PROFILE_MESSAGES } from '../../messages.js'
import { BLOCK_SCOPES, isBlockScope, specBlocks, type BlockScope } from '../../spec-block.js'

export const BLOCK_FORM_ID = 'user-block-form'

const ALL_SCOPES = Object.keys(BLOCK_SCOPES) as BlockScope[]

export function createBlockFormDescription(allowedScopes: readonly string[] = ALL_SCOPES) {
  const scopes = allowedScopes.filter(isBlockScope)
  const list = scopes.length ? scopes : ALL_SCOPES
  return defineForm({
    id: BLOCK_FORM_ID,
    revision: 1,
    messages: { ...AUTH_MESSAGES, ...PROFILE_MESSAGES },
    actions: [
      { id: 'save', label: 'Сохранить', validate: 'full' },
      { id: 'lift', label: specBlocks.liftButton, validate: 'none' },
    ],
    fields: {
      block_id: field.hidden({ defaultValue: '' }),
      subject: field.hidden({ defaultValue: '' }),
      subjects: field.multiselect({
        label: 'Целевые пользователи',
        placeholder: 'Выберите пользователей',
        defaultValue: [],
      }),
      scope: field.select({
        label: specBlocks.scopeLabel,
        defaultValue: list[0] ?? 'auth',
        options: list.map((value) => ({
          value,
          label: `${BLOCK_SCOPES[value].title} — ${BLOCK_SCOPES[value].description}`,
        })),
      }),
      reason: field.textarea({
        label: specBlocks.reasonLabel,
        help: specBlocks.reasonHelp,
        validate: [v.required(), v.minLength(1), v.maxLength(500)],
      }),
      forever: field.checkbox({
        label: specBlocks.foreverLabel,
        defaultValue: true,
      }),
      until: field['datetime-local']({
        label: specBlocks.untilLabel,
      }),
    },
  })
}

export const blockForm = createBlockFormDescription(ALL_SCOPES)
