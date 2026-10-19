/**
 * Данные универсальной демо-панели.
 *
 * Панель — ОДИН компонент (`DemoPanel`) для любого раздела: схема полей приходит
 * данными, адресную механику (seed, коммит, бронь ключей, GET без JS) панель
 * подключает сама через `#lib/address`. Наружу она отдаёт ПАРАМЕТРЫ — объект
 * «ключ: значение»; потребитель либо подставляет значения в `if/else`, либо
 * передаёт объект своей библиотеке.
 *
 * Поле схемы описывает только СВОИ данные: подпись, вид, умолчание, политику
 * адреса и условия выключения. Разметку рисует панель (канон панелей настроек)
 * или `ui`-сниппет страницы.
 */

/** Значение поля панели: варианты и тумблеры адресуются строками. */
export type DemoValue = string | boolean

/** Вариант списка. `jsOnly` — вариант требует JavaScript (до оживления выключен). */
export interface DemoOption {
  value: string
  label: string
  jsOnly?: boolean
}

/** Политика адреса поля. */
export interface DemoUrlPolicy {
  /** Ключ адреса; по умолчанию — ключ поля. */
  key?: string
  /**
   * Не писать значение, равное умолчанию: адрес остаётся чистым
   * (`?demo=url` не появляется, снятый тумблер пишет только отличие).
   */
  omitWhenDefault?: boolean
}

interface DemoFieldBase {
  /** Ключ поля: имя контрола, ключ значения и (по умолчанию) ключ адреса. */
  key: string
  label: string
  /** Статическая подсказка поля. */
  hint?: string
  /** Поле требует JS: до оживления выключено (решение shell, не данные). */
  jsOnly?: boolean
  /** Куда значение едет в адрес; `false` — только в параметры потребителя. */
  url?: DemoUrlPolicy | false
  /**
   * Смена поля начинает НОВЫЙ СЦЕНАРИЙ: адрес пересобирается из полей панели,
   * чужие ключи сценария снимаются (как переход на чистый адрес).
   */
  resetsScenario?: boolean
  /** Почему поле выключено при текущих значениях (причина = disabled + подсказка). */
  disabledWhen?(values: DemoValues): string | undefined
  /** Подсказка, зависящая от значений (например, «в этом режиме не адресуется»). */
  hintOf?(values: DemoValues): string | undefined
}

export interface DemoSelectField extends DemoFieldBase {
  type: 'select'
  options: readonly DemoOption[]
  defaultValue: string
}

export interface DemoToggleField extends DemoFieldBase {
  type: 'toggle'
  defaultValue: boolean
}

export interface DemoTextField extends DemoFieldBase {
  type: 'text'
  defaultValue: string
}

export interface DemoDivider {
  type: 'divider'
  label: string
}

export type DemoField = DemoSelectField | DemoToggleField | DemoTextField
export type DemoFieldSpec = DemoField | DemoDivider

/** Значения полей панели. */
export type DemoValues = Record<string, DemoValue>

/**
 * Схема панели — только данные. `V` — форма параметров, которые панель отдаёт
 * потребителю (`DemoPanel.onParams`, `demoParams`).
 */
export interface DemoPanelSchema<V extends DemoValues = DemoValues> {
  /** Владелец брони ключей адреса и id формы (уникален на страницу). */
  id: string
  /** Адрес нативного GET без JavaScript. */
  action: string
  /** Поля в порядке вывода; `divider` открывает группу. */
  fields: readonly DemoFieldSpec[]
  /** Значения → параметры потребителя; по умолчанию — значения как есть. */
  toParams?(values: V): Record<string, unknown>
  /**
   * Полная навигация с загрузкой данных вместо мелкой записи адреса.
   * По умолчанию `false`: параметры демо читаются клиентом.
   */
  load?: boolean
}

/** Объявление схемы с выводом типа параметров из полей (хелпер). */
export function defineDemoPanel<V extends DemoValues>(schema: DemoPanelSchema<V>): DemoPanelSchema<V> {
  return schema
}
