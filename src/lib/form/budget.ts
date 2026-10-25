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
 * Действующий бюджет: `min(объявленный, потолок окружения)`.
 *
 * Потолок — то, что реально пропустит транспорт (env развёртывания). Число в
 * описании больше потолка **молча игнорируется**: уменьшать бюджет форма вправе,
 * увеличивать — нет. Не объявлено ничего — `undefined` (суммарной проверки нет).
 */
export function effectiveBudget(
  declared: number | undefined,
  ceiling: number | undefined,
): number | undefined {
  if (declared === undefined) return ceiling
  if (ceiling === undefined) return declared
  return Math.min(declared, ceiling)
}

/**
 * Свести бюджет формы.
 *
 * @param budget Объявленный формой бюджет тела, байт; `undefined` — не объявлен.
 * @param fileFields Имена файловых полей в порядке объявления.
 * @param ceiling Потолок окружения (env развёртывания): объявленное больше него
 *   молча урезается. `undefined` — потолок неизвестен (браузер, юнит-тесты).
 */
export function formLimits(
  budget: number | undefined,
  fileFields: readonly string[],
  ceiling?: number,
): FormLimits {
  const effective = effectiveBudget(budget, ceiling)
  if (effective === undefined) return { budget: null, filesBytes: Number.POSITIVE_INFINITY, fileFields }
  if (!Number.isFinite(effective) || effective <= 0)
    throw new Error('[lib/form] бюджет тела: ожидается положительное число байт')
  return { budget: effective, filesBytes: Math.max(0, effective - FILE_BUDGET_RESERVE), fileFields }
}

/**
 * Те же пределы под потолок окружения: суммарная проверка включается, даже если
 * форма бюджет не объявляла, — потолок и есть бюджет.
 */
export function withCeiling(limits: FormLimits, ceiling: number | undefined): FormLimits {
  if (ceiling === undefined) return limits
  const budget = effectiveBudget(limits.budget ?? undefined, ceiling)
  return {
    budget: budget ?? null,
    filesBytes: budget === undefined ? Number.POSITIVE_INFINITY : Math.max(0, budget - FILE_BUDGET_RESERVE),
    fileFields: limits.fileFields,
  }
}
