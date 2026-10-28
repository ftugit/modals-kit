import { defineForm, field, v, type FormDescription } from '#lib/form/index.js'
import type { CookieVaultSchema, CookieVaultSpec } from './types.js'

const SCOPE_RE = /^[a-z][a-z0-9_]{0,19}$/
export const VAULT_SLOT_ID_RE = /^[a-z][a-z0-9_-]{0,23}$/
export const DEFAULT_VAULT_MAX_ENTRIES = 8

function makeDeleteForm(scope: string, defaultId = ''): FormDescription {
  return defineForm({
    id: `dv_del_${scope}`,
    fields: {
      slot_id: field.hidden({
        defaultValue: defaultId,
        validate: [v.required(), v.maxLength(24)],
      }),
    },
  })
}

function makeResetKeyForm(scope: string): FormDescription {
  return defineForm({
    id: `dv_reset_${scope}`,
    fields: {
      confirm_scope: field.hidden({
        defaultValue: scope,
        validate: [v.required(), v.maxLength(24)],
      }),
    },
  })
}

/**
 * Объявить схему экземпляра универсального куки-сейфа.
 * Каждый экземпляр задаёт свою `entryForm` (`defineForm`), правила `parse` и `mask`,
 * а UI-раскладка полей передаётся отдельным компонентом в `<CookieVault form={...} />`.
 */
export function defineCookieVault<
  TEntry = Record<string, unknown>,
  TMeta = Record<string, unknown>,
>(spec: CookieVaultSpec<TEntry, TMeta>): CookieVaultSchema<TEntry, TMeta> {
  if (!SCOPE_RE.test(spec.scope)) {
    throw new RangeError(
      `[cookie-vault] некорректный scope «${spec.scope}» (ожидался /^[a-z][a-z0-9_]{0,19}$/)`,
    )
  }
  const maxEntries = spec.maxEntries ?? DEFAULT_VAULT_MAX_ENTRIES
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 16) {
    throw new RangeError('[cookie-vault] maxEntries обязан быть целым числом от 1 до 16')
  }

  return {
    ...spec,
    maxEntries,
    deleteForm: makeDeleteForm(spec.scope),
    deleteFormFor: (id: string) => makeDeleteForm(spec.scope, id),
    resetKeyForm: makeResetKeyForm(spec.scope),
  }
}
