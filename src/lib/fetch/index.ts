// #lib/fetch — обёртка над `fetch` для обращений к чужим сервисам.
// Без зависимостей от фреймворка: работает везде, где есть `fetch`,
// `AbortSignal.timeout` и `AbortSignal.any` (Node 20+, современные браузеры).

export { createFetch, retryAfter } from './create.js'
export type { AppFetch, CreateFetchOptions, FetchClock, FetchInit, FetchWait, HostPolicy, RetryPolicy } from './create.js'
export { FetchError, isAbortError } from './errors.js'
export type { FetchErrorCode, FetchErrorOptions } from './errors.js'
export { ensureOk, readJson, readText } from './read.js'
export type { ReadOptions } from './read.js'
export { fetchWithTask, readTaskStream, TASK_STREAM_ACCEPT, TASK_STREAM_TYPE } from './stream.js'
export type { StreamProgress, StreamTask } from './stream.js'
