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
 * или `ui`-компонент страницы.
 *
 * Типы — часть защиты на сборке: ключи полей ограничены параметрами потребителя
 * (`keyof V`), а список через `demoSelect` проверяет ещё и умолчание (оно обязано
 * быть одним из вариантов). Файл — только типы: ни SvelteKit, ни `.svelte`.
 */

/** Значение поля панели: варианты и тумблеры адресуются строками. */
export type DemoValue = string | boolean

/** Вариант списка. `jsOnly` — вариант требует JavaScript (до оживления выключен). */
export interface DemoOption<V extends string = string> {
  value: V
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

interface DemoFieldBase<K extends string = string> {
  /** Ключ поля: имя контрола, ключ значения и (по умолчанию) ключ адреса. */
  key: K
  label: string
  /** Статическая подсказка поля. */
  hint?: string
  /** Поле требует JS: до оживления выключено (решение shell, не данные). */
  jsOnly?: boolean
  /** Куда значение едет в адрес; `false` — только в параметры потребителя. */
  url?: DemoUrlPolicy | false
  /**
   * Смена поля начинает НОВЫЙ СЦЕНАРИЙ: адрес пересобирается из полей панели,
   * чужие ключи сценария снимаются (как переход на чистый адрес). Такое поле
   * обязано писаться в адрес: `url: false` вместе с флагом — ошибка схемы.
   */
  resetsScenario?: boolean
  /** Почему поле выключено при текущих значениях (причина = disabled + подсказка). */
  disabledWhen?(values: DemoValues): string | undefined
  /** Подсказка, зависящая от значений (например, «в этом режиме не адресуется»). */
  hintOf?(values: DemoValues): string | undefined
}

export interface DemoSelectField<K extends string = string, V extends string = string>
  extends DemoFieldBase<K> {
  type: 'select'
  options: readonly DemoOption<V>[]
  defaultValue: V
}

export interface DemoToggleField<K extends string = string> extends DemoFieldBase<K> {
  type: 'toggle'
  defaultValue: boolean
}

export interface DemoTextField<K extends string = string> extends DemoFieldBase<K> {
  type: 'text'
  defaultValue: string
}

export interface DemoDivider {
  type: 'divider'
  label: string
}

export type DemoField<K extends string = string> =
  | DemoSelectField<K>
  | DemoToggleField<K>
  | DemoTextField<K>

export type DemoFieldSpec<K extends string = string> = DemoField<K> | DemoDivider

/** Значения полей панели. */
export type DemoValues = Record<string, DemoValue>

/**
 * Схема панели — только данные. `V` — форма параметров, которые панель отдаёт
 * потребителю (`DemoPanel.onParams`, `demoParams`); ключи полей обязаны быть
 * ключами `V` — опечатка ловится на сборке.
 */
export interface DemoPanelSchema<V extends DemoValues = DemoValues> {
  /** Владелец брони ключей адреса и id формы (уникален на страницу). */
  id: string
  /** Адрес нативного GET без JavaScript. */
  action: string
  /** Поля в порядке вывода; `divider` открывает группу. */
  fields: readonly DemoFieldSpec<Extract<keyof V, string>>[]
  /** Значения → параметры потребителя; по умолчанию — значения как есть. */
  toParams?(values: V): Record<string, unknown>
  /**
   * Полная навигация с загрузкой данных вместо мелкой записи адреса.
   * По умолчанию `false`: параметры демо читаются клиентом.
   */
  load?: boolean
}

/**
 * Самое общее, что нужно хелперам: данные схемы без параметров потребителя.
 * `DemoPanelSchema<V>` подходит сюда при любом `V` — ключи полей шире не станут.
 */
export type DemoSchemaData = {
  readonly id: string
  readonly fields: readonly DemoFieldSpec<string>[]
}
