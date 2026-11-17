/**
 * Серверный API базового модуля. `*.server.ts` сюда не входят: их тянут
 * только серверные потребители напрямую, чтобы клиентский импорт барреля
 * не наткнулся на SvelteKit-границу.
 */
export * from './acl.js'
export * from './admin.js'
export * from './auth.js'
export * from './blocks.js'
export * from './bulk.js'
export * from './caps.js'
export { defaults, createUserConfig, type ConfigScope, type ConfigValues, type StoreLike, type UserConfig } from './config.js'
export * from './config-api.js'
export * from './keys.js'
export * from './permissions.js'
export * from './ports.js'
export * from './spec-config.js'
export * from './vault.js'
