/**
 * Адрес экрана переноса схемы — один на всё приложение.
 *
 * Отдельный крошечный модуль, а не часть `./db-schema.ts`: его читает страница
 * ошибок (`#components/ErrorPage.svelte`), и она не должна тянуть в клиентский
 * бандл ни описание формы решений, ни `#lib/db/sync` ради строки `/schema`.
 * Здесь только адрес и код состояния — ни зависимостей, ни состояния.
 */
import { localPath } from '#lib/address/index.js'

/** Экран переноса схемы (отчёт + решения под `DB_ADMIN_TOKEN`). */
export const SCHEMA_PATH = '/schema'

/**
 * Адрес экрана с возвратом на исходную страницу.
 * @param from путь, куда вернуться после переноса; проверяется `localPath`.
 * @returns `/schema` либо `/schema?next=<локальный путь>`.
 */
export function schemaHref(from?: string | null): string {
  const next = localPath(from ?? null)
  return next && next !== SCHEMA_PATH ? `${SCHEMA_PATH}?next=${encodeURIComponent(next)}` : SCHEMA_PATH
}

/**
 * Код отказа означает расхождение схемы (её нужно перенести человеком).
 * @param code `body.code` из `toKitError` либо сам `FailureKind` (`#lib/db`).
 * @returns `true` для `schema_pending`.
 */
export const isSchemaPending = (code: string | undefined): boolean => code === 'schema_pending'
