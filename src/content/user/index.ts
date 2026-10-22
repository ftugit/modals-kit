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
export { defaults, createUserConfig, type UserConfig } from './config.js'
export * from './ports.js'
export { seedOf } from './keys.js'
