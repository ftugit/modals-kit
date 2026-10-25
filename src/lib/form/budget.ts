// Бюджет тела формы и бюджет файлов.
//
// Тело ограничивает транспорт: env развёртывания → `Limits.maxBytes` обработчика.
// Из бюджета тела вычитается резерв на текст (остальные поля, границы multipart,
// служебные `__form_*`) — остаток и есть бюджет ВСЕХ файлов формы. Число
// объявляет приложение в описании (`defineForm({ limits: { budget } })`), причём
// значение больше env игнорируется на стороне приложения: `min(объявленный, env)`.
// Ядро число не выдумывает: не объявлено — суммарная проверка выключена.

/** Резерв бюджета тела под текст: прочие поля, границы multipart, `__form_*`. */
export const FILE_BUDGET_RESERVE = 1024 * 1024

/** Ограничения формы, которые видит правило при проверке. */
export interface FormLimits {
  /** Объявленный бюджет тела, байт; `null` — не объявлен, суммарная проверка выключена. */
  readonly budget: number | null
  /** Бюджет всех файлов формы, байт: `budget − FILE_BUDGET_RESERVE`; без бюджета — `Infinity`. */
  readonly filesBytes: number
  /** Имена файловых полей в порядке объявления — сумма считается стабильно. */
  readonly fileFields: readonly string[]
}

/**
 * Свести бюджет формы.
 *
 * `undefined` — форма бюджета не объявляла: суммарная проверка выключена, предел
 * файла остаётся тем, что объявил валидатор.
 */
export function formLimits(budget: number | undefined, fileFields: readonly string[]): FormLimits {
  if (budget === undefined) return { budget: null, filesBytes: Number.POSITIVE_INFINITY, fileFields }
  if (!Number.isFinite(budget) || budget <= 0)
    throw new Error('[form] limits.budget: ожидается положительное число байт')
  return { budget, filesBytes: Math.max(0, budget - FILE_BUDGET_RESERVE), fileFields }
}
