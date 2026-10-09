// Реестр на экземпляр, а не на модуль.
//
// Модульный реестр на сервере копит регистрации между запросами, а два
// приложения в одном процессе делят его молча. Умолчательный остаётся
// для краткости — он один из, а не единственный.
import { BUILTIN_TYPES } from './builtins'
import { keep } from './keep'
import { FieldTypeRegistry, type FieldType } from './field-types'
import { InstructionRegistry, type ErrorInstruction } from './external'
import { BUILTIN_VALIDATORS, ValidatorRegistry, type Validator } from './validators'

export class Registry {
  readonly types = new FieldTypeRegistry()
  readonly validators = new ValidatorRegistry()
  readonly instructions = new InstructionRegistry()
  readonly #patterns = new Map<string, string>()

  registerType<V>(type: FieldType<V>): this { this.types.register(type); return this }
  registerValidator(name: string, factory: (arg: any) => Validator<any>): this {
    this.validators.register(name, factory); return this
  }
  /** Инструкция разбора ответа чужой службы. */
  registerInstruction(i: ErrorInstruction): this { this.instructions.register(i); return this }
  /**
   * Именованный шаблон: белый список расширяется регистрацией, а не правкой ядра.
   * @param name Имя шаблона в ссылках `{ rule: 'pattern', arg: name }`.
   * @param source Исходник регулярного выражения без якорей.
   */
  registerPattern(name: string, source: string): this {
    keep(this.#patterns, name, source, 'шаблон')
    return this
  }
  /** Исходник именованного шаблона либо `undefined`. */
  pattern(name: string): string | undefined { return this.#patterns.get(name) }
  /** Все зарегистрированные имена шаблонов. */
  patterns(): readonly string[] { return [...this.#patterns.keys()] }
}

export const BUILTIN_PATTERNS: Readonly<Record<string, string>> = {
  e164: '\\+[1-9]\\d{7,14}',
  slug: '[a-z0-9]+(?:-[a-z0-9]+)*',
  hexColor: '#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})',
  postalRu: '\\d{6}',
}

/** Новый реестр со встроенным содержимым. */
export function createRegistry(): Registry {
  const r = new Registry()
  for (const t of BUILTIN_TYPES) r.registerType(t as FieldType<any>)
  for (const [name, make] of Object.entries(BUILTIN_VALIDATORS)) r.registerValidator(name, make)
  for (const [name, source] of Object.entries(BUILTIN_PATTERNS)) r.registerPattern(name, source)
  return r
}

/** Умолчательный реестр. Удобство, а не единственная возможность. */
export const defaultRegistry = createRegistry()
