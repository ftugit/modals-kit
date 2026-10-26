/**
 * Модуль пользователя (`src/content/user`): API, схема для БД и форм, ошибки
 * с проводкой в форму, UI ACL, адаптер-связка. Единая точка для REST,
 * POST-обработчиков и gateway — «ошмётков» модуля по проекту нет: всё здесь.
 */
export * from './types.js'
export * from './error.js'
export * from './acl.js'
export * from './auth.js'
export * from './profile.js'
export * from './accounts.js'
export * from './admin.js'
export * from './permissions.js'
export { defaults, createUserConfig, type UserConfig } from './config.js'
export * from './ports.js'
export { seedOf } from './keys.js'

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
