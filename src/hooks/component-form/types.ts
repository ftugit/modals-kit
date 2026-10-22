import type { RequestEvent } from '@sveltejs/kit'
import type { BindOptions } from '#lib/form/svelte/index.js'
import type { ExecuteContext, ExecuteOutput, Limits } from '#lib/form/server.js'
import type { CheckRegistry, FormDescription, Result } from '#lib/form/index.js'

/** Клиентские опции привязки встраиваемой формы к текущему маршруту. */
export interface ComponentFormOptions extends Omit<BindOptions, 'action' | 'transport'> {
  /** Явный адрес экшена (по умолчанию — текущий видимый маршрут `pathname + search`). */
  action?: string
  /** Хук подготовки `FormData` перед отправкой в JS-транспорте. */
  prepare?: (data: FormData) => void | Promise<void>
}

/**
 * Решение после успешного нативного POST (без JS):
 * - строка — целевой адрес для `303 See Other` (PRG);
 * - `'inline'` — отрендерить текущую страницу сразу в этом же ответе с `locals.formResult = result`
 *   (нужно многошаговым формам, когда ответ переводит виджет на следующий шаг);
 * - `null | undefined` — `303` на текущую страницу (`pathname + search`).
 */
export type NoJsSuccessTarget = string | 'inline' | null | undefined

/** Серверная регистрация POST-обработчика встраиваемой формы компонента. */
export interface ComponentFormRegistration {
  readonly description: FormDescription
  readonly checks?: CheckRegistry
  readonly limits?: Partial<Limits>
  readonly execute: (
    ctx: ExecuteContext,
    event: RequestEvent,
  ) => ExecuteOutput<unknown> | Promise<ExecuteOutput<unknown>>
  readonly redirectOnSuccess?: (event: RequestEvent, result: Result) => NoJsSuccessTarget
}
