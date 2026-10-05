// Публичная поверхность.
//
//     описание(поля, правила) → связывание(настройка) → наборы пропсов
//
// Всё здесь — чистый TypeScript. Адаптеры движков живут в ./svelte/, ./react/ и ./solid/.
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
export * from './editor'
export * from './spec'
export * from './source'
export * from './continuation'
export * from './queued'
export * from './upload'
export * from './devtools'
export * from './envelope'
export * from './state'
export * from './submit'
export * from './messages'
