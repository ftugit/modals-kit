// Клиентская привязка встраиваемой формы компонента к текущему маршруту.
//
// Где бы ни рендерился компонент (страница, модалка поверх любого маршрута,
// шаг виджета), его `<form method="post" action={target}>` и JS-транспорт
// указывают ровно на текущий видимый адрес (`pathname + search`), а
// `continuation` автоматически подхватывает `page.data.formResult`, если
// нативный POST без JS отрендерил ответ для этой формы.
import { untrack } from 'svelte'
import { page } from '$app/state'
import { visibleAddress } from '#lib/address/sveltekit.js'
import { bind, type BoundConfig, type BoundForm } from '#lib/form/svelte/index.js'
import { kitActionTransport } from '#lib/components/form/transport.js'
import type { FormDescription, Result } from '#lib/form/index.js'
import type { ComponentFormOptions } from './types.js'

function readCurrentHref(): string {
  try {
    const u = visibleAddress().url
    return (u.pathname || '/') + u.search
  } catch {
    return '/'
  }
}

function readPageFormResult(expectedFormId: string): Result | null {
  try {
    const candidate = (page.data as { formResult?: Result | null } | undefined)?.formResult ?? null
    return candidate && candidate.formId === expectedFormId ? candidate : null
  } catch {
    return null
  }
}

export function bindComponentForm(
  cfg: BoundConfig,
  desc: FormDescription,
  options: ComponentFormOptions = {},
): BoundForm {
  const { action, prepare, continuation, ...rest } = options
  const target = untrack(() => action ?? readCurrentHref())
  const initialContinuation = untrack(() => continuation ?? readPageFormResult(desc.id))

  return bind(cfg, desc, {
    ...rest,
    action: target,
    transport: kitActionTransport(target, prepare ? { prepare } : {}),
    continuation: initialContinuation,
  })
}
