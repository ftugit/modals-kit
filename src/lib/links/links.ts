/**
 * Связки — нейтральное ядро живого слоя «что запрещено сочетать».
 *
 * Домен здесь只有一个 факт: ВЫБРАНО ОДНО → НЕДОСТУПНО ДРУГОЕ. Слова «фильтр»,
 * «панель», «URL» ядру неизвестны: их приносит словарь потребителя
 * (`./catalog`, позже `./panel`) — идентично тому, как `lib/search` не знает
 * про аниме, а знает про перехват.
 *
 * Ядро несёт три вещи:
 *   • расчёт (`computeLinks`) — какие поля и значения выключены ПРИ ТЕКУЩИХ
 *     значениях; решение чистое и вызывается с обеих сторон одинаково (SSR
 *     рисует выключенным, клиент пересчитывает на каждое изменение);
 *   • составитель текстов (`linkHelperText` / `linkRefusalText`) — helper поля
 *     и отказ валидатора сочиняются из ОДНОГО firings-набора: место показа
 *     отличается, формулировка нет;
 *   • сборка набора (`linkSubmission`) — выключенное из набора для отправки
 *     вырезается, в самой форме значения НЕ стираются: снял блокирующий
 *     параметр — поле вернулось со всем, что в нём было.
 *
 * `when`-условия и эффекты адресуют поле идентификатором, каким его видит
 * словарь (ключ, путь — решение словаря); `read` объясняет, что там сейчас
 * лежит. Ядру важен лишь ответ: пусто / непусто / содержит ли значение.
 */

/** Условие связки: поле заполнено; с `value` — равно или содержит это значение. */
export interface LinkCondition {
  readonly field: string
  readonly value?: string
}

/** Что делает связка: гасит поле или отдельное значение в списке поля. */
export type LinkEffect =
  | { readonly kind: 'disable-field'; readonly field: string }
  | { readonly kind: 'disable-option'; readonly field: string; readonly value: string }

/**
 * Одна связка. `reason` — СЫРОЕ объявление («у анонсов нет оценки»); кто
 * виновник, добавляет составитель текста, а не автор правила.
 */
export interface LinkRule {
  readonly id: string
  readonly when: readonly LinkCondition[]
  readonly effect: LinkEffect
  readonly reason: string
}

/** Что сейчас лежит в поле-идентификаторе. Пустой список = «не выбрано». */
export type LinkValues = (field: string) => readonly string[]

/** Сработавшая связка + кто по её условиям виновник (имена берёт словарь). */
export interface LinkFiring {
  readonly rule: LinkRule
  /** Поля из `when` без повторов, в порядке объявления. */
  readonly blockers: readonly string[]
}

/** Итог расчёта при текущих значениях. */
export interface LinkOutcome {
  /** Все сработавшие связки в порядке правил: предупреждения панели, отказ набора. */
  readonly firings: readonly LinkFiring[]
  /** Ключ → последнее погасившее её срабатывание (перекрывает предыдущее). */
  readonly fields: ReadonlyMap<string, LinkFiring>
  /** Ключ → значения, выключенные внутри поля. */
  readonly options: ReadonlyMap<string, ReadonlySet<string>>
}

/** Заполнено ли условие: непустое поле; с `value` — presence этого значения. */
function conditionMet(read: LinkValues, condition: LinkCondition): boolean {
  const values = read(condition.field)
  return condition.value === undefined ? values.length > 0 : values.includes(condition.value)
}

/** Расчёт «что выключено сейчас». Чисто; `rules` — уже перевод словаря. */
export function computeLinks(rules: readonly LinkRule[], read: LinkValues): LinkOutcome {
  const firings: LinkFiring[] = []
  const fields = new Map<string, LinkFiring>()
  const options = new Map<string, Set<string>>()
  for (const rule of rules) {
    if (!rule.when.every((condition) => conditionMet(read, condition))) continue
    const blockers: string[] = []
    for (const condition of rule.when) {
      if (!blockers.includes(condition.field)) blockers.push(condition.field)
    }
    const firing: LinkFiring = { rule, blockers }
    firings.push(firing)
    if (rule.effect.kind === 'disable-field') {
      fields.set(rule.effect.field, firing)
    } else {
      const set = options.get(rule.effect.field) ?? new Set<string>()
      set.add(rule.effect.value)
      options.set(rule.effect.field, set)
    }
  }
  return { firings, fields, options }
}

/** Имя поля для текстов: словарь знает подписи, ядро — нет. */
export type LinkLabel = (field: string) => string

const quoted = (labels: readonly string[]): string => labels.map((x) => `«${x}»`).join(' и ')

/**
 * Helper выключенного поля: `«Статус» блокирует поле: у анонсов нет оценки`.
 * Виновник называется, потому что «список невозможного» пользователю не ответ.
 */
export function linkHelperText(firing: LinkFiring, label: LinkLabel): string {
  const verb = firing.blockers.length > 1 ? 'блокируют' : 'блокирует'
  return `${quoted(firing.blockers.map(label))} ${verb} поле: ${firing.rule.reason}`
}

/**
 * Отказ валидатора (no-JS): `«Оценка» невозможно использовать совместно с
 * «Статус»`. Те же данные, другая реплика: helper объясняет ПОКАЗАНИЕ,
 * отказ — ПРИЧИНУ НЕПРИМЕНЕНИЯ набора. `blockers` — идентификаторы полей из
 * `when`; повторы допустимы (одно поле в двух условиях), текст от них чище.
 */
export function linkRefusalText(field: string, blockers: readonly string[], label: LinkLabel): string {
  const who = [...new Set(blockers)].map((x) => `«${label(x)}»`).join(', ')
  return `«${label(field)}» невозможно использовать совместно с ${who}`
}

/**
 * Набор для отправки: из `values` вырезаны выключенные поля и выключенные
 * значения. Остальное — без изменений, включая порядок. Это НЕ трогание
 * формы: форма хранит выбор выключенного поля, а набор — чист.
 */
export function linkSubmission(
  values: Readonly<Record<string, readonly string[]>>,
  isFieldDisabled: (field: string) => boolean,
  isOptionDisabled: (field: string, value: string) => boolean,
): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {}
  for (const [field, list] of Object.entries(values)) {
    if (isFieldDisabled(field)) continue
    const kept = list.filter((value) => !isOptionDisabled(field, value))
    if (kept.length) out[field] = kept
  }
  return out
}
