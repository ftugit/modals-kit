// Однократная настройка проекта.
//
// Хук приложения существует только затем, чтобы не повторять ЭТО на каждой
// форме. Библиотека фабрики хуков не поставляет: `bind` работает и без хука.
import type { Component } from 'svelte'
import type { ErrorHandler } from '../errors'
import type { InvalidFrom } from '../describe'
import type { MessageDictionary } from '../messages'
import type { FormPolicy } from '../policy'
import type { Registry } from '../registry'
import type { FormState } from '../state'
import type { ParallelPolicy, Transport } from '../submit'
import type { HtmlAttrs, InputMode, ValueKind } from '../types'
import type { FieldView } from './bind.svelte'

/** Компонент поля пишет ПРИЛОЖЕНИЕ. Он получает FieldView и ничего больше. */
export type FieldComponent = Component<FieldView>

export type LiveMode = 'on-submit' | 'on-blur' | 'on-input' | 'after-touched'

/** Минимум, которого довольно для выбора компонента. */
export interface ResolveTarget {
  readonly name: string
  readonly input: InputMode
  readonly kind: ValueKind
}

/**
 * Политика адаптера: то, что раньше было зашито в сборке пропсов.
 * Умолчания остаются прежними — меняется возможность их заменить.
 */
export interface UiPolicy {
  /** Идентификатор элемента поля. */
  fieldId(formId: string, name: string): string
  /** Состав `aria-describedby` из идентификаторов подсказки и ошибки. */
  describedBy(parts: { help?: string; error?: string }): string | undefined
  /** Когда перепроверять поле на вводе и уходе. */
  shouldValidate(e: {
    event: 'input' | 'blur'
    name: string
    live: LiveMode
    state: FormState
  }): boolean
  /** Как значение попадает в разметку. Источник истины — DOM, это лишь начальное. */
  valueAttrs(f: { kind: ValueKind; defaultValue?: unknown }, value: unknown): HtmlAttrs
}

export const defaultUi: UiPolicy = {
  fieldId: (formId, name) => `${formId}-${name.replace(/\./g, '-')}`,
  describedBy: ({ help, error }) => [help, error].filter(Boolean).join(' ') || undefined,
  shouldValidate: ({ event, name, live, state }) => {
    // эскалация: поле с ошибкой после неудачной отправки проверяется на вводе
    if (state.submitCount > 0 && state.facts.some((e) => e.path === name)) return true
    if (event === 'blur') return live === 'on-blur' || live === 'after-touched'
    if (live === 'on-input') return true
    return live === 'after-touched' && state.touched[name] === true
  },
  valueAttrs: (f, value) => {
    if (f.kind === 'checkbox') return value ? { checked: true } : {}
    if (value !== undefined && value !== null && value !== '') return { value: String(value) }
    return f.defaultValue !== undefined ? { value: String(f.defaultValue) } : {}
  },
}

export interface FormsConfig {
  /**
   * Соответствие «представление → компонент приложения». ФУНКЦИЯ, не таблица.
   * Вернула `undefined` — это ДЕФЕКТ КОНФИГУРАЦИИ: умолчаний у библиотеки нет.
   */
  resolve(f: ResolveTarget): FieldComponent | undefined
  messages?: MessageDictionary
  transport?: Transport
  actionBase?: string
  live?: LiveMode
  parallel?: ParallelPolicy
  /** Обработчик ошибок проекта. Форма может задать свой. */
  onErrors?: ErrorHandler
  /** Откуда берётся «поле невалидно» по умолчанию. */
  invalidFrom?: InvalidFrom
  /** Реестр и политика проекта: по умолчанию общие. */
  registry?: Registry
  policy?: FormPolicy
  /** Политика разметки адаптера. */
  ui?: Partial<UiPolicy>
}

export interface BoundConfig {
  readonly config: FormsConfig
  readonly ui: UiPolicy
  resolveView(f: ResolveTarget): FieldComponent
}

export function createConfig(config: FormsConfig): BoundConfig {
  return {
    config,
    ui: { ...defaultUi, ...config.ui },
    resolveView(f) {
      const c = config.resolve(f)
      if (!c)
        throw new Error(
          `[form] нет компонента для представления '${f.input}' (поле '${f.name}'). ` +
          'Дополните resolve в настройке проекта: умолчаний у библиотеки нет.')
      return c
    },
  }
}
