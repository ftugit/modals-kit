/**
 * При DATABASE_RESET=1/true/yes в конце build удаляет все обычные и
 * секционированные таблицы public из выделенной DATABASE_URL; саму схему и её
 * права сохраняет. В рантайме schema.gate разворачивает модели и администратора.
 * Внимание: данные удаляются до переключения трафика на новый деплой.
 */
import pg from 'pg'
import { resetPublicTables } from './db-reset-lib.mjs'

const flag = /^(1|true|yes)$/i.test((process.env.DATABASE_RESET ?? '').trim())
if (!flag) process.exit(0)

const clean = (value) => (value ?? '').trim().replace(/^["']+|["']+$/g, '')
const url = clean(process.env.DATABASE_URL)
if (!url) {
  console.error('[db-reset] DATABASE_RESET включён, но DATABASE_URL пуст; сброс невозможен')
  process.exit(1)
}
// В рантайме Hyperdrive имеет приоритет. Не сообщать об успехе, сбросив
// другую базу. Разные строки для одного сервера также нужно согласовать явно.
const hyperdrive = clean(process.env.HYPERDRIVE_CONNECTION_STRING)
if (hyperdrive && hyperdrive !== url) {
  console.error('[db-reset] HYPERDRIVE_CONNECTION_STRING перекрывает DATABASE_URL в рантайме; сброс остановлен, чтобы не очистить другую базу')
  process.exit(1)
}

const rawTimeout = Number((process.env.DB_CONNECT_TIMEOUT_MS ?? '').trim())
const connectionTimeoutMillis =
  Number.isSafeInteger(rawTimeout) && rawTimeout >= 1 ? rawTimeout : 30_000

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis })
try {
  await client.connect()
  const count = await resetPublicTables(client)
  console.log(`[db-reset] таблицы public очищены при сборке: ${count}; схема и её права сохранены`)
} catch (e) {
  // Не выводим connection string или детали подключения: они могут содержать секреты.
  const code = typeof e?.code === 'string' && /^[A-Z][A-Z0-9_]{1,31}$/.test(e.code) ? ` (код ${e.code})` : ''
  const message = e?.message === 'схема public отсутствует; её должен создать владелец базы или провайдер' ||
    e?.message === 'в public есть внешние или принадлежащие расширению таблицы; автоматический сброс остановлен'
    ? `: ${e.message}` : ''
  console.error(`[db-reset] сброс таблиц public не выполнен${code}${message}. Проверьте подключение, владельцев таблиц и зависимости; при ошибке выполнена попытка отката.`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
