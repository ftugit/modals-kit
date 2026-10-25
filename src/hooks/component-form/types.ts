import type { RequestEvent } from '@sveltejs/kit'
import type { BindOptions } from '#lib/form/svelte/index.js'
import type { createFormHandler, ExecuteContext, ExecuteOutput, Limits } from '#lib/form/server.js'
import type { CheckRegistry, FormDescription, Result } from '#lib/form/index.js'
import type { TaskState } from '#lib/task/index.js'

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

/**
 * Ход долгой операции, о котором форма сообщает строками ответа
 * (`#hooks/task-stream.server.ts`). Тип структурный намеренно: этот файл
 * изоморфный и не имеет права тянуть серверный модуль даже за типом.
 */
export type ComponentFormWatch = (report: (task: TaskState) => void) => () => void

/**
 * Задача формы: результат, который будет готов позже (`queued`). Опрос идёт
 * на адрес самой формы — `?__form_id=<id>&__form_task=<task>` — и получает
 * JSON; отдельная точка входа маршруту больше не нужна.
 */
export interface ComponentFormTask {
  poll: (id: string, event: RequestEvent) => unknown | Promise<unknown>
}

/** Серверная регистрация POST-обработчика встраиваемой формы компонента. */
export interface ComponentFormRegistration {
  /** Идентификатор формы (обязателен, только если `description` вычисляется функцией от `event`). */
  readonly id?: string
  readonly description: FormDescription | ((event: RequestEvent) => FormDescription)
  /** Динамический источник описания и ревизии (`defineForm({ from })`). */
  readonly source?: FormSource
  readonly checks?: CheckRegistry | ((event: RequestEvent) => CheckRegistry | Promise<CheckRegistry>)
  readonly limits?: Partial<Limits>
  /** Бронь отправки (повтор с тем же `__form_submission` — тот же ответ). */
  readonly idempotency?: NonNullable<Parameters<typeof createFormHandler>[0]['idempotency']>
  /** Ограничитель частоты: ключ по адресу клиента требует `event`. */
  readonly throttle?: NonNullable<Parameters<typeof createFormHandler>[0]['throttle']>
  /** Подготовка значений ДО правил формы (очистка, вычисление, метки). */
  readonly prepare?: NonNullable<Parameters<typeof createFormHandler>[0]['prepare']>
  readonly execute: (
    ctx: ExecuteContext,
    event: RequestEvent,
    raw?: FormData,
  ) => ExecuteOutput<unknown> | Promise<ExecuteOutput<unknown>>
  readonly redirectOnSuccess?: (event: RequestEvent, result: Result) => NoJsSuccessTarget
  /** Подписки на ход общих операций (запуск базы, перенос схемы) для `taskResponse`. */
  readonly watch?: readonly ComponentFormWatch[]
  /** Опрос задачи на адресе формы (`?__form_task=…`). */
  readonly task?: ComponentFormTask
}
