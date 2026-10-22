// Привязка формы встраиваемого компонента к текущему маршруту.
//
// Где бы ни рендерился компонент, его `<form method="post" action={here}>` и
// JS-транспорт указывают ровно на ту страницу (`pathname + search`), на которой
// компонент сейчас смонтирован, а `continuation` автоматически подхватывает
// `page.data.formResult`, поднятый серверным `componentFormsHandle` после
// нативного POST без JS.
import { untrack } from 'svelte'
import { page } from '$app/state'
import { visibleAddress } from '#lib/address/sveltekit.js'
import {
  bind,
  type BindOptions,
  type BoundConfig,
  type BoundForm,
} from '#lib/form/svelte/index.js'
import type { FormDescription, Result } from '#lib/form/index.js'
import { kitActionTransport } from './transport.js'

export interface RouteFormOptions extends Omit<BindOptions, 'action' | 'transport'> {
  /** Явный адрес экшена (по умолчанию — текущий видимый маршрут `pathname + search`). */
  action?: string
  /** Хук подготовки `FormData` перед отправкой в JS-транспорте. */
  prepare?: (data: FormData) => void | Promise<void>
}

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

export function bindRouteForm(
  cfg: BoundConfig,
  desc: FormDescription,
  options: RouteFormOptions = {},
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
