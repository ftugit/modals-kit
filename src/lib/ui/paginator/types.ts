// Типы демо-панели настроек пагинатора.
//
// Панель — ДАННЫЕ: список `SettingsField` описывает поля, выключения и маппинг
// в extra. Компилятор (`./compile`) превращает их в `FormDescription` для
// механизма форм; размечает всё одна оболочка (`PaginatorSettings`).
//
// Условие доступности — данные, а не функция (§6.4 следствие 3): `enabledBy`
// проверяем на сервере, из него же инвертируются правила связок. Функция
// `enabledWhen(values)` так данные оценить не позволяла.
import type { ExtraValue, FeatureGate } from '$lib/paginate'

/** Одна связка «поле доступно при значении другого». */
export interface PanelEnabledBy {
  /** Ключ поля этой же панели (без префикса адреса). */
  readonly field: string
  /** Доступно, когда поле равно этому значению. */
  readonly equals?: string | boolean
  /** Доступно, когда значение поля — из этого списка. */
  readonly in?: readonly (string | boolean)[]
  /**
   * Текста нет — составитель строит его из условия («доступно при …»), но
   * домену бывает что добавить: причина уходит и в helper, и в отказ.
   */
  readonly reason?: string
}

export type SettingsField<V extends Record<string, ExtraValue> = Record<string, ExtraValue>> =
  | {
      key: keyof V & string
      label: string
      type: 'select'
      options: readonly (readonly [string, string])[]
      /** Маппер «значение формы → extra»: селект отдаёт строку, extra — тип. */
      parse?: (raw: string) => ExtraValue
      jsOnly?: boolean
      /**
       * Возможность(и) ИСТОЧНИКА, без которых параметр не работает: панель гасит
       * поле И ПОКАЗЫВАЕТ ПРИЧИНУ, а не «включает и молчит».
       */
      requires?: FeatureGate | readonly FeatureGate[]
      enabledBy?: readonly PanelEnabledBy[]
    }
  | {
      key: keyof V & string
      label: string
      type: 'toggle'
      jsOnly?: boolean
      requires?: FeatureGate | readonly FeatureGate[]
      enabledBy?: readonly PanelEnabledBy[]
    }
  | {
      type: 'divider'
      label?: string
    }
