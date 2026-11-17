import type { ComponentFormRegistration } from './types.js'

let map: Map<string, ComponentFormRegistration> | undefined

/**
 * Единое хранилище серверных форм.
 * Инициализируется лениво внутри hoisted-функции `componentFormRegistry()`,
 * чтобы при слиянии модулей в один чанк Rolldown / Rollup вызов
 * `registerComponentForm(...)` из `*.form.server.ts` работал в любом порядке склейки.
 */
export function componentFormRegistry(): Map<string, ComponentFormRegistration> {
  return (map ??= new Map())
}

/** Зарегистрировать серверный контракт встраиваемой формы. */
export function registerComponentForm(reg: ComponentFormRegistration): void {
  const id = reg.id ?? (typeof reg.description === 'function' ? undefined : reg.description.id)
  if (!id) {
    throw new Error('[component-form] `id` is required when `description` is a function')
  }
  const store = componentFormRegistry()
  const existing = store.get(id)
  if (existing && existing !== reg) {
    throw new Error(`[component-form] duplicate form id "${id}"`)
  }
  store.set(id, reg)
}
