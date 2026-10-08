/**
 * Валидатор связок: отказ по полю (решение §6.3, вариант A).
 *
 * Живой слой (helper + disabled) объясняет ПОЛЬЗОВАТЕЛЮ; валидатор объясняет
 * СЕРВЕРУ, почему набор не создан. Третьего мира нет: без JS про disabled
 * никто не знает — запрещённая комбинация приходит в наборе и обязана быть
 * отклонена тем же знанием схемы, из которого растёт и helper.
 *
 * Правило отказа (модель §7.5): он касается только поля, где значение
 * ДЕЙСТВИТЕЛЬНО выбрано; пустое запрещённое поле ничего не нарушает.
 * Отказ влечёт весь набор: фильтр-движок на ошибках значений не отдаёт
 * (`validateCatalogFilterValues` → `values = {}`), источник не получает
 * ничего — «частичного применения» не существует.
 *
 * Фабрика нейтральна: значения условий, пути и подписи ей приносит словарь —
 * она умеет только читать `ctx.values` по путям и вернуть код сообщения, чей
 * текст собирает словарь (тот же составитель, что и у helper).
 */
import { issue, type FieldContext, type Validator } from '$lib/form/validators'

/** Условие-зонд: где искать и что искать; label — для текста отказа. */
export interface LinkBlockedCondition {
  readonly label: string
  readonly paths: readonly string[]
  readonly value?: string
}

/** Одно правило, бьющее по ЭТОМУ полю (валидатор вешается на блокируемое). */
export interface LinkBlockedProbe {
  readonly id: string
  readonly when: readonly LinkBlockedCondition[]
}

/** Непусто ли значение поля после декодирования (список/строка/число). */
function filled(raw: unknown): boolean {
  if (Array.isArray(raw)) return raw.some((item) => item !== '')
  return raw !== undefined && raw !== null && raw !== ''
}

function pathHas(values: Record<string, unknown>, path: string, value: string): boolean {
  const raw = values[path]
  if (Array.isArray(raw)) return raw.includes(value)
  return raw === value
}

/**
 * Валидатор для одного блокируемого поля. Пустое значение поля — всегда `null`
 * (запрет без выбора ничего не нарушает); иначе первое выполненное правило
 * даёт `link.blocked` с параметрами для словарного текста.
 */
export function linkBlockedValidator(
  probes: readonly LinkBlockedProbe[],
  selfLabel: string,
): Validator {
  return (value: unknown, ctx: FieldContext) => {
    if (!filled(value)) return null
    let blockers: string | undefined
    for (const probe of probes) {
      const met = probe.when.every((condition) => condition.value === undefined
        ? condition.paths.some((path) => filled(ctx.values[path]))
        : condition.paths.some((path) => pathHas(ctx.values, path, condition.value!)))
      if (!met) continue
      // Та же кардинальность, что у ядра и view: два правила на одно поле —
      // говорит ПОСЛЕДНЕЕ объявленное (view перезаписывает строку тем же
      // порядком; расхождения двух реплик о разных правилах недопустимы).
      blockers = [...new Set(probe.when.map((condition) => condition.label))]
        .map((label) => `«${label}»`)
        .join(', ')
    }
    if (!blockers) return null
    return issue('link.blocked', { field: selfLabel, blockers })
  }
}
