/**
 * Своя разметка полей демо-панели — по образцу фильтров (`FilterFormProps` →
 * компонент приложения, поля расставлены руками).
 *
 * Панель остаётся оболочкой: форма (нативный GET, «Применить» до оживления),
 * адрес, бронь ключей — её; UI-компонент рисует только поля и получает от
 * панели готовые вьюхи: значение, атрибуты механизма, причину выключения и
 * варианты (уже с учётом `jsOnly` до оживления). Ничего про адрес UI не знает.
 */
import type { BoundForm, FieldView } from '#lib/form/svelte/index.js'
import { JS_ONLY_REASON } from '#lib/hooks/js-only.svelte.js'
import type { DemoField, DemoOption, DemoPanelSchema, DemoValues } from './types.js'

/** Готовое поле для своей разметки. */
export interface DemoFieldUi {
  /** Вьюха механизма `lib/form`: значение, `attrs`, ошибки, подпись. */
  readonly v: FieldView
  /** Данные схемы: вид, подпись, умолчание. */
  readonly spec: DemoField
  /** Поле выключено: причиной схемы (`disabledWhen`) или до оживления (`jsOnly`). */
  readonly disabled: boolean
  /** Подсказка: причина выключения сильнее статических подсказок поля. */
  readonly hint: string | undefined
  /** Варианты списка с уже проставленным `disabled` у `jsOnly` до оживления. */
  readonly options: readonly (DemoOption & { disabled: boolean })[]
}

/** Пропсы UI-компонента демо-панели (`DemoPanel` → `ui`). */
export interface DemoUiProps {
  /** Связывание формы панели: `field(name)` и `submitVisible` — те же, что у панели. */
  readonly form: BoundForm
  /** Схема — данные страницы: по ней UI берёт подписи, варианты, порядок. */
  readonly schema: DemoPanelSchema
  /** Живые значения полей. */
  readonly values: Readonly<DemoValues>
  /** Готовое поле по ключу схемы (см. `DemoFieldUi`). */
  readonly field: (name: string) => DemoFieldUi
  /** Подвал панели — сниппет `DemoPanel` приходит в UI уже развёрнутым? Нет: рисует сама панель. */
}

/** Найти поле схемы по ключу. */
export function demoFieldSpec(
  schema: DemoPanelSchema,
  name: string,
): DemoField | undefined {
  return schema.fields.find((f): f is DemoField => f.type !== 'divider' && f.key === name)
}

/**
 * Готовое поле для своей разметки: вьюха механизма + решения схемы (причина
 * выключения, `jsOnly` до оживления, подсказка) + варианты списка.
 */
export function demoFieldUi(schema: DemoPanelSchema, form: BoundForm, name: string): DemoFieldUi {
  const spec = demoFieldSpec(schema, name)
  if (!spec) throw new Error(`[demo] в схеме «${schema.id}» нет поля «${name}»`)
  const v = form.field(name)
  if (!v) throw new Error(`[demo] форма «${schema.id}» не знает поля «${name}»`)
  const values = form.values as DemoValues
  const reason = spec.disabledWhen?.(values)
  // До оживления jsOnly-поле выключено — и обязано СКАЗАТЬ почему: подсказка
  // «доступно после загрузки JavaScript» проверяется браузерным набором.
  const jsOnly = spec.jsOnly === true && form.submitVisible
  const hint = reason ?? (jsOnly ? JS_ONLY_REASON : undefined) ?? spec.hintOf?.(values) ?? spec.hint
  const disabled = v.disabled === true || reason !== undefined || jsOnly
  const options =
    spec.type === 'select'
      ? spec.options.map((o) => ({
          ...o,
          disabled: o.jsOnly === true && form.submitVisible,
        }))
      : []
  return { v, spec, disabled, hint, options }
}
