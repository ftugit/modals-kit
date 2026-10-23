// Слой хранилищ: контракт и память процесса. Библиотека окружение не читает:
// какое хранилище куда передать, решает приложение в одном месте
// (у нас — `src/server/cache.server.ts`).
export type { AtomicStore, MaybePromise, ScopeOptions, Store } from './types'
export { isAtomic, requireAtomic } from './types'
export type { MemoryStore, MemoryStoreOptions } from './memory'
export { memoryStore } from './memory'
