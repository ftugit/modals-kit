/**
 * Модуль пользователя (`src/content/user`): API, схема для БД и форм, ошибки
 * с проводкой в форму, адаптер-связка. Единая точка для REST, POST-экшенов и
 * gateway — «ошмётков» модуля по проекту нет: всё здесь.
 */
export * from './types.js'
export * from './error.js'
export * from './user.js'
export * from './ports.js'
export { generateKeyPair, sign as signWithSecret, verify as verifyWithSeed } from './keys.js'
