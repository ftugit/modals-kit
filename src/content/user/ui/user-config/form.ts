import { defineForm, field } from '#lib/form/index.js'
import { USER_MESSAGES } from '../../messages.js'
import { ALL_CONFIG_KEYS, CONFIG_KEYS, isConfigKey, specConfig } from '../../spec-config.js'
import type { UserConfigItem } from '../../types.js'

export const USER_CONFIG_FORM_ID = 'user-config'

/**
 * Детерминированная ревизия динамического набора редактируемых полей (`>= 1`):
 * если администратор меняет права записи на ключ, ревизия меняется и форма
 * честно ловит устаревание (`form.stale`).
 */
export function computeUserConfigRevision(editableItems: readonly UserConfigItem[]): number {
  const editableKeys = new Set(
    editableItems.filter((i) => i.editable && isConfigKey(i.key)).map((i) => i.key),
  )
  let mask = 0
  for (let i = 0; i < ALL_CONFIG_KEYS.length; i++) {
    if (editableKeys.has(ALL_CONFIG_KEYS[i]!)) {
      mask |= 1 << i
    }
  }
  return 1 + mask
}

/**
 * Построить динамическое описание формы настроек по списку редактируемых ключей.
 * Доступные только для чтения параметры сюда НЕ включаются — они не отправляются
 * в запросе и отклоняются слоем `namesLayer` при попытке подделки.
 */
export function createUserConfigDescription(editableItems: readonly UserConfigItem[]) {
  const dynamicFields: Record<string, ReturnType<typeof CONFIG_KEYS[keyof typeof CONFIG_KEYS]['toField']>> = {}
  for (const item of editableItems) {
    if (!item.editable || !isConfigKey(item.key)) continue
    dynamicFields[item.fieldName] = CONFIG_KEYS[item.key].toField(item.value)
  }

  return defineForm({
    id: USER_CONFIG_FORM_ID,
    revision: computeUserConfigRevision(editableItems),
    messages: USER_MESSAGES,
    actions: [
      { id: 'save', label: specConfig.saveButton, validate: 'full' },
      { id: 'reset', label: specConfig.resetButton, validate: 'none' },
    ],
    fields: {
      subject: field.hidden({ defaultValue: '' }),
      ...dynamicFields,
    },
  })
}

export const userConfigBaseForm = createUserConfigDescription([])
