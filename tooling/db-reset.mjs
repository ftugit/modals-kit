/**
 * При DATABASE_RESET=1/true/yes в конце build сбрасывает поддерживаемые
 * объекты public в выделенной DATABASE_URL, сохраняя саму схему и её права.
 * Требуются права владельца БД, управление подключениями и maintenance database.
 * Внимание: данные удаляются до переключения трафика на новый деплой.
 */
import { exclusiveReset } from './db-exclusive-lib.mjs'

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
  Number.isSafeInteger(rawTimeout) && rawTimeout >= 1 && rawTimeout <= 2147483647 ? rawTimeout : 30_000

try {
  const count = await exclusiveReset(url, connectionTimeoutMillis)
  console.log(`[db-reset] public очищена при сборке: таблиц ${count.tables}, представлений ${count.views}, функций/процедур ${count.routines}; схема и её права сохранены`)
} catch (e) {
  // Сообщения БД и URL могут содержать секреты: допускаем только наши фиксированные тексты.
  const safe = new Set([
    'URL базы не позволяет однозначно определить целевую БД',
    'для сброса нужна отдельная целевая БД, не postgres',
    'другой сброс базы уже выполняется',
    'целевая БД не найдена',
    'подключения к целевой БД отключены; требуется восстановление владельцем',
    'роль сброса не владеет целевой БД; безопасный сброс невозможен',
    'контрольное подключение не подтверждает тот же сервер и базу',
    'в целевой БД есть подготовленные транзакции; сброс остановлен',
    'целевая БД занята системными процессами; сброс остановлен',
    'запрет новых подключений снят; сброс остановлен',
    'прежние подключения не закрылись вовремя; сброс не начат',
    'некорректный таймаут подключения и ожидания освобождения БД',
    'в public остались неподдерживаемые объекты; полный сброс отменён',
    'схема public отсутствует; её должен создать владелец базы или провайдер',
    'в public есть внешние или принадлежащие расширению таблицы; автоматический сброс остановлен',
    'таблицы public связаны наследованием или секциями с другой схемой; автоматический сброс остановлен',
    'набор таблиц public изменился во время сброса; автоматический сброс остановлен',
    'подключения к БД не восстановлены автоматически; срочно обратитесь к владельцу БД',
    'исход COMMIT неизвестен; проверьте состояние базы до повторного сброса',
    'сброс зафиксирован, но подключение после восстановления не подтверждено',
  ])
  const code = typeof e?.code === 'string' && /^[A-Z][A-Z0-9_]{1,31}$/.test(e.code) ? ` (код ${e.code})` : ''
  const message = safe.has(e?.message) ? `: ${e.message}` : ''
  console.error(`[db-reset] операция не подтверждена${code}${message}. Проверьте права и состояние БД; при потере соединения исход COMMIT может быть неизвестен.`)
  process.exitCode = 1
}
