// Публичная поверхность.
//
//     модалка(ядро(хранилище), опции)
//
// Всё, кроме ./cores/<фреймворк> и ./<фреймворк>/, — чистый TypeScript.

export * from './types'
export * from './core'
export { createModalStore, getClientStore, resetClientStore } from './store'
export type { ModalStore, ModalStoreData, StoreListener } from './store'
export { createRegistry, globalScope, registerModal, explainMissing } from './registry'
export type { AnyDefinition, ModalRegistry, ResolveHit } from './registry'

// модалка
export { createModals } from './create'
export type { Modals, ModalsOptions } from './create'

// ядро
export {
  canLink, canPreload,
  assertTransient, assertTransientOnTop,
} from './core-contract'
export type {
  ModalCore, CoreCapabilities, PreloadResult,
  ReadContext, HrefContext, WriteOptions,
} from './core-contract'
export { memoryCore } from './cores/memory'

// хранилища
export { urlStorage, localStorageChain, memoryStorage, parseStoredChain } from './storages'
export type { ChainStorage, MinimalStorage, StorageEnv } from './storages'

// внутренности ядра (нужны, только если пишете своё)
export { buildCore } from './build'
export type { CoreOptions, Sources } from './build'
export { memoryEngine } from './engine'
export type { ChainEngine } from './engine'

// Ядро SvelteKit импортируется отдельно, чтобы этот модуль
// оставался собираемым без SvelteKit:
//   import { svelteKitCore } from '$lib/modals/cores/sveltekit'
