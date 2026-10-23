import type { RequestEvent } from '@sveltejs/kit'
import type { BindOptions } from '#lib/form/svelte/index.js'
import type { createFormHandler, ExecuteContext, ExecuteOutput, Limits } from '#lib/form/server.js'
import type { CheckRegistry, FormDescription, Result } from '#lib/form/index.js'

type FormSource = NonNullable<Parameters<typeof createFormHandler>[0]['source']>

/** Явный контракт координации сессии для форм, работающих от имени пользователя. */
export interface FormSessionGuard {
  /** Проверить/освежить истёкший временный снимок перед отправкой запроса. */
  ensureFresh(): Promise<boolean>
  /** Вызывается при ответе `auth.expired`; при `true` исходный запрос повторяется 1 раз. */
  onAuthExpired(): Promise<boolean>
}

/** Клиентские опции привязки встраиваемой формы к текущему маршруту. */
export interface ComponentFormOptions extends Omit<BindOptions, 'action' | 'transport'> {
  /** Явный адрес экшена (по умолчанию — текущий видимый маршрут `pathname + search`). */
  action?: string
  /** Хук подготовки `FormData` перед отправкой в JS-транспорте. */
  prepare?: (data: FormData) => void | Promise<void>
  /** Опциональная защита сессии (продление мёртвого токена и 1x-повтор при `auth.expired`). */
  session?: FormSessionGuard
  /** Ключ блокировки навигации в `page.state` на время отправки формы. */
  lockStateKey?: string
  /** Вызывается при применённом успехе (`status === 'success' && outcome !== 'not-applied'`). */
  onSuccess?: (result: Result) => void
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
  /** Идентификатор формы (обязателен, только если `description` вычисляется функцией от `event`). */
  readonly id?: string
  readonly description: FormDescription | ((event: RequestEvent) => FormDescription)
  /** Динамический источник описания и ревизии (`defineForm({ from })`). */
  readonly source?: FormSource
  readonly checks?: CheckRegistry | ((event: RequestEvent) => CheckRegistry | Promise<CheckRegistry>)
  readonly limits?: Partial<Limits>
  readonly execute: (
    ctx: ExecuteContext,
    event: RequestEvent,
    raw?: FormData,
  ) => ExecuteOutput<unknown> | Promise<ExecuteOutput<unknown>>
  readonly redirectOnSuccess?: (event: RequestEvent, result: Result) => NoJsSuccessTarget
}
