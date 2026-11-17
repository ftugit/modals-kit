/**
 * Модуль пользователя (`src/content/user`): API, схема для БД и форм, ошибки
 * с проводкой в форму, UI ACL, адаптер-связка. Единая точка для REST,
 * POST-обработчиков и gateway — «ошмётков» модуля по проекту нет: всё здесь.
 */
export * from './model/types.js'
export * from './model/error.js'
export * from './service/acl.js'
export * from './service/auth.js'
export * from './service/admin.js'
export * from './service/permissions.js'
export { defaults, createUserConfig, type UserConfig } from './service/config.js'
export * from './service/ports.js'
export { seedOf } from './service/keys.js'
export * from './service/spec-config.js'
export * from './service/config-api.js'
export * from './model/spec-block.js'
export * from './service/blocks.js'

/** Плоские значения `?stage=` / параметров модалки `user.auth` → канонический шаг `AuthWidget`. */
const LEGACY_AUTH_STAGE: Record<string, string> = {
  entry: 'auth.entry',
  register: 'auth.register',
  restore: 'auth.restore',
}

export function resolveAuthStep(stage: unknown): string | undefined {
  if (typeof stage !== 'string' || !stage) return undefined
  return LEGACY_AUTH_STAGE[stage] ?? stage
}
