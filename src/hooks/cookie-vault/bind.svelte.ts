// Привязка пользовательской формы экземпляра куки-сейфа (по аналогии с `bindFilters`).
//
// Экземпляр пишет собственный `.svelte`-компонент формы, раскладывая свои `<Field>` руками:
//   let props: CookieVaultFormProps<MyMeta> = $props()
//   const vault = bindCookieVault(() => props)
import { bindComponentForm } from '#hooks/component-form/index.js'
import type {
  BoundCookieVaultForm,
  CookieVaultFormProps,
  CookieVaultSnapshot,
} from './types.js'

export function bindCookieVault<TMeta = Record<string, unknown>>(
  read: () => CookieVaultFormProps<TMeta>,
): BoundCookieVaultForm {
  const initial = read()
  const bound = bindComponentForm(initial.config, initial.schema.entryForm, {
    instance: `dv_entry:${initial.schema.scope}`,
    onSuccess: (res) => {
      const payload = res.data as { snapshot?: CookieVaultSnapshot<TMeta> } | undefined
      if (payload?.snapshot) {
        read().onSaved?.(payload.snapshot)
      }
    },
  })

  return {
    form: bound,
    f: bound.f,
    common: bound.common,
    state: bound.state,
    hidden: () => bound.hidden(),
  }
}
