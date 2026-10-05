// Слой Solid: однократная настройка проекта.
//
// Соответствия «представление → компонент» здесь нет: в Solid приложение
// само выбирает компонент поля по `input` из FieldView. Настройка собирает
// умолчания (транспорт, режимы) и политику разметки адаптера. Для каждой
// формы это повторяется один раз, а не в каждой связке.
import type { ErrorHandler } from '../errors'
import type { InvalidFrom } from '../describe'
import type { MessageDictionary } from '../messages'
import type { FormState } from '../state'
import type { ParallelPolicy, Transport } from '../submit'

/** Режим живой проверки. */
export type LiveMode = 'on-submit' | 'on-blur' | 'on-input' | 'after-touched'

/**
 * Политика разметки адаптера: то, что раньше было зашито в сборке пропсов.
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
  valueAttrs(f: { kind: string; defaultValue?: unknown }, value: unknown): Record<string, unknown>
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
  // Solid пишет HTML-атрибуты как есть: перекладка имён React не нужна
  valueAttrs: (f, value) => {
    if (f.kind === 'checkbox') return { checked: Boolean(value) }
    const v = value === undefined || value === null ? f.defaultValue ?? '' : value
    return { value: String(v) }
  },
}

/** Однократная настройка проекта: то, что не повторяется на каждой форме. */
export interface FormsConfig {
  /** Тексты поверх словаря формы. */
  messages?: MessageDictionary
  /** Транспорт по умолчанию для всех форм. */
  transport?: Transport
  /** Префикс адресов нативной отправки. */
  actionBase?: string
  /** Режим живой проверки по умолчанию. */
  live?: LiveMode
  /** Политика параллельных отправок. */
  parallel?: ParallelPolicy
  /** Обработчик ошибок проекта. Форма может задать свой. */
  onErrors?: ErrorHandler
  /** Откуда берётся «поле невалидно» по умолчанию. */
  invalidFrom?: InvalidFrom
  /** Политика разметки адаптера: идентификаторы, `aria-describedby`, эскалация. */
  ui?: Partial<UiPolicy>
}

export interface BoundConfig {
  readonly config: FormsConfig
  readonly ui: UiPolicy
}

/**
 * Настройка проекта форм: умолчания и политика разметки.
 * @param config Умолчания для всех форм проекта.
 * @returns Конфигурацию для `createForm`.
 */
export function createConfig(config: FormsConfig): BoundConfig {
  return { config, ui: { ...defaultUi, ...config.ui } }
}
