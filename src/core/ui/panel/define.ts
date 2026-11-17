/**
 * Объявление схемы демо-панели и его проверки — ЗАЩИТА НА СБОРКЕ.
 *
 * Три уровня, все видны до появления страницы у пользователя:
 *
 *  1. типы (`keyof V`, `demoSelect` с const-параметром) — ловит `svelte-check`
 *     и `build`: чужой ключ, умолчание не из вариантов;
 *  2. `defineDemoPanel` проверяет данные при ИМПОРТЕ модуля — падает dev, SSR
 *     и тесты (в том числе скан-тест всех `demo-schema.ts`);
 *  3. `validateDemoPanel` можно позвать отдельно (например, из теста схемы),
 *     чтобы ошибка назвала файл, а не только поле.
 *
 * Проверяется то, что типы не видят: дубликаты ключей, пустые/кривые имена,
 * пустые списки, повтор вариантов, `action` не путём, `url: false` вместе со
 * `resetsScenario`, `toParams` не функция. Сообщения сразу перечисляют ВСЕ
 * найденное: чинить схему раз за разом по одной ошибке — наказание.
 */
import { DEV } from 'esm-env'
import type {
  DemoDivider,
  DemoField,
  DemoOption,
  DemoPanelSchema,
  DemoSelectField,
  DemoToggleField,
  DemoTextField,
  DemoValues,
} from './types.js'

/** Ключ поля/адреса: латиница, цифры, `_`, `-`, `.` (точечные семейства). */
const KEY = /^[A-Za-z][\w.-]*$/

type RawSchema = {
  readonly id?: unknown
  readonly action?: unknown
  readonly fields?: unknown
  readonly toParams?: unknown
  readonly load?: unknown
}

/** Все нарушения схемы одним списком; пусто — схема верна. */
export function demoPanelDefects(schema: unknown): string[] {
  const s = (schema ?? {}) as RawSchema
  const out: string[] = []

  if (typeof s.id !== 'string' || s.id.trim() === '')
    out.push('id схемы пуст: он бронирует ключи адреса и становится id формы')
  else if (!KEY.test(s.id))
    out.push(`id «${s.id}» не годится в бронь: латиница, цифры, «_», «-», «.»`)

  if (typeof s.action !== 'string' || s.action === '')
    out.push('action пуст: без него нативная GET-форма не отправится')
  else if (!s.action.startsWith('/'))
    out.push(`action «${s.action}» должен быть путём от корня («/steps»)`)

  if (s.toParams !== undefined && typeof s.toParams !== 'function')
    out.push('toParams объявлен, но не функция')
  if (s.load !== undefined && typeof s.load !== 'boolean')
    out.push('load — только boolean')

  const fields = s.fields
  if (!Array.isArray(fields) || fields.length === 0) {
    out.push('fields пуст: панели без полей нечего показывать')
    return out
  }

  const seen = new Set<string>()
  let real = 0
  for (const spec of fields as readonly (DemoField<string> | DemoDivider)[]) {
    if (!spec || typeof spec !== 'object') {
      out.push('в fields попал не объект поля')
      continue
    }
    if (spec.type === 'divider') {
      if (typeof spec.label !== 'string' || spec.label.trim() === '')
        out.push('разделитель без подписи')
      continue
    }
    real++
    const name = typeof spec.key === 'string' ? spec.key : ''
    const where = name ? `поле «${name}»` : 'поле без ключа'
    if (!name) out.push('поле без ключа: ключ — имя контрола, значение и ключ адреса')
    else if (!KEY.test(name)) out.push(`${where}: ключ из латиницы, цифр, «_», «-», «.»`)
    if (name) {
      if (seen.has(name)) out.push(`${where}: ключ повторяется`)
      seen.add(name)
    }
    if (typeof spec.label !== 'string' || spec.label.trim() === '')
      out.push(`${where}: пустая подпись`)
    if (spec.jsOnly !== undefined && typeof spec.jsOnly !== 'boolean')
      out.push(`${where}: jsOnly — только boolean`)
    if (spec.resetsScenario !== undefined && typeof spec.resetsScenario !== 'boolean')
      out.push(`${where}: resetsScenario — только boolean`)
    if (spec.resetsScenario === true && spec.url === false)
      out.push(`${where}: сценарное поле обязано писаться в адрес, а url: false — нет`)
    if (spec.url !== undefined && spec.url !== false) {
      if (typeof spec.url !== 'object' || spec.url === null)
        out.push(`${where}: url — объект политики или false`)
      else if (spec.url.key !== undefined && !KEY.test(String(spec.url.key)))
        out.push(`${where}: ключ адреса «${String(spec.url.key)}» не годится`)
    }

    if (spec.type === 'select') {
      const options = Array.isArray(spec.options) ? spec.options : []
      if (options.length === 0) out.push(`${where}: список без вариантов`)
      const values = new Set<string>()
      for (const o of options as readonly DemoOption[]) {
        if (!o || typeof o.value !== 'string' || o.value === '')
          out.push(`${where}: вариант без значения`)
        else {
          if (values.has(o.value)) out.push(`${where}: вариант «${o.value}» повторяется`)
          values.add(o.value)
        }
        if (typeof o?.label !== 'string' || o.label.trim() === '')
          out.push(`${where}: у варианта «${String(o?.value)}» пустая подпись`)
      }
      if (typeof spec.defaultValue !== 'string')
        out.push(`${where}: умолчание списка — строка`)
      else if (!values.has(spec.defaultValue))
        out.push(
          `${where}: умолчание «${spec.defaultValue}» отсутствует в вариантах (${[...values].join(', ')})`,
        )
    } else if (spec.type === 'toggle') {
      if (typeof spec.defaultValue !== 'boolean') out.push(`${where}: умолчание тумблера — boolean`)
    } else if (spec.type === 'text') {
      if (typeof spec.defaultValue !== 'string') out.push(`${where}: умолчание текста — строка`)
    } else out.push(`${where}: неизвестный вид «${String((spec as { type?: unknown }).type)}»`)
  }
  if (real === 0) out.push('fields: ни одного поля, только разделители')
  return out
}

/** Проверить схему; при нарушениях — исключение со списком всех проблем. */
export function validateDemoPanel(schema: unknown, source?: string): void {
  const defects = demoPanelDefects(schema)
  if (defects.length === 0) return
  const id = (schema as { id?: unknown })?.id
  throw new Error(
    ['[demo] схема демо-панели неверна' + (source ? ` (${source})` : '') + (id ? ` — «${String(id)}»` : '') + ':',
      ...defects.map((d) => '  • ' + d),
      '',
      'Правила: docs/design/universal-demo-panel.md, раздел «Проверка схемы».',
    ].join('\n'),
  )
}

/**
 * Объявить схему панели. Проверка выполняется здесь, при импорте модуля: ошибка
 * в данных валит dev, SSR и тесты — до того, как страницу увидит пользователь.
 * Типы дополнительно требуют, чтобы ключи полей были ключами `V`.
 */
export function defineDemoPanel<V extends DemoValues>(
  schema: DemoPanelSchema<V>,
): DemoPanelSchema<V> {
  // Проверка — сборке и разработке, не пользователю: схема статична, в прод-
  // бандле `DEV` вырезается вместе с проверками (иначе +1.1 КБ на каждый
  // маршрут). Гейты сборки — `svelte-check` (типы) и скан-тест схем.
  if (DEV) validateDemoPanel(schema)
  return schema
}

/* ── хелперы полей: const-параметры делают проверки типов сильнее ───────── */

type SelectArgs<K extends string, O extends readonly DemoOption[]> = Omit<
  DemoSelectField<K>,
  'type' | 'options' | 'defaultValue'
> & {
  /** Варианты; умолчание обязано быть ОДНИМ из их значений (проверяет tsc). */
  options: O
  defaultValue: O[number]['value']
}

/**
 * Поле-список. Варианты передаются литералами (`as const` не нужен): из них
 * выводится объединение значений, и умолчание вне списка — ошибка сборки,
 * а не пустой селект у пользователя.
 */
export function demoSelect<const K extends string, const O extends readonly DemoOption[]>(
  field: SelectArgs<K, O>,
): DemoSelectField<K, O[number]['value']> {
  return { type: 'select', ...field } as DemoSelectField<K, O[number]['value']>
}

/** Поле-тумблер (значение в адресе — «true»/«false»). */
export function demoToggle<const K extends string>(
  field: Omit<DemoToggleField<K>, 'type'>,
): DemoToggleField<K> {
  return { type: 'toggle', ...field } as DemoToggleField<K>
}

/** Поле-строка. */
export function demoText<const K extends string>(
  field: Omit<DemoTextField<K>, 'type'>,
): DemoTextField<K> {
  return { type: 'text', ...field } as DemoTextField<K>
}

/** Разделитель группы. */
export function demoDivider(label: string): DemoDivider {
  return { type: 'divider', label }
}
