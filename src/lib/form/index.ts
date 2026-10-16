// Публичная поверхность.
//
//     описание(поля, правила) → связывание(настройка) → наборы пропсов
//
// Всё здесь — чистый TypeScript. Адаптер движка живёт в ./svelte/ (React/Solid удалены в ходе 25 — C9; будут написаны заново).
// Библиотека НЕ создаёт элементов разметки: теги расставляет приложение.

export * from './types'
export * from './policy'
export * from './registry'
export * from './keep'
export * from './constraints'
export * from './field-types'
export * from './builtins'
export * from './strength'
export * from './validators'
export * from './describe'
export * from './decode'
export * from './validate'
export * from './result'
export * from './errors'
export * from './external'
export * from './async'
export * from './schema'
export * from './proof'
export * from './spec'
// каталог набора — внутренность `field.fields`: наружу только типы
export type {
  FieldKit, FieldSetItem, KitArgLimits, KitBound, KitDefect, KitField, KitKind, KitRuleLimits, KitRulesFor,
} from './kit'
export * from './field-set'
export * from './source'
export * from './url'
export * from './queued'
export * from './envelope'
export * from './state'
export * from './submit'
export * from './messages'
