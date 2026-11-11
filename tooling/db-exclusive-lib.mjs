import pg from 'pg'
import { resetPublicObjects } from './db-reset-lib.mjs'

const quote = (value) => `"${value.replaceAll('"', '""')}"`

/**
 * Ключ блокировки синхронизации схемы. Совпадает с тем, что берёт
 * `src/lib/db/sync/index.ts`: `hashtext(kit)::bigint`, где `kit` — это
 * `(spec.table ?? 'public.kit_schema')`, пропущенное через `ident()`
 * (`'"' + s + '"'`), то есть ровно `"public"."kit_schema"`.
 *
 * Совпадение не случайно, а обязательно: пока идёт сброс, ни один живой
 * инстанс не должен выполнять `sync` — иначе он пересоздаст таблицы
 * посреди `DROP`. Раньше это достигалось запретом новых подключений; теперь
 * достигается общей блокировкой. Ключ проверяется тестом
 * `tooling/db-reset-postgres.test.mjs` («сброс и синхронизация схемы
 * сериализуются одной блокировкой»).
 */
const SYNC_LOCK_KEY = '"public"."kit_schema"'

/**
 * Сброс объектов `public` в ОДНОЙ базе, без второй БД и без запрета подключений.
 *
 * Работает только в целевой базе: служебное подключение открывается по той же
 * строке. Требование отдельной maintenance-базы `postgres` снято — у провайдеров
 * вроде Clever Cloud её нет, и сброс падал, не начавшись.
 *
 * Подключения не запрещаются и чужие сеансы принудительно не завершаются:
 * DDL конфликтует только с активными транзакциями на сбрасываемых таблицах,
 * а не с фактом открытого соединения. Idle-соединения сбросу не мешают, поэтому
 * ожидать их закрытия не нужно. Предел ожидания блокировки — `lock_timeout`,
 * берётся из `connectionTimeoutMillis`.
 *
 * Побочный эффект: во время сброса живые инстансы продолжают работать и могут
 * получить ошибку на запросе к удаляемой таблице. Это плата за сброс без
 * остановки трафика и она выбрана владельцем сознательно.
 */
export async function exclusiveReset(connectionString, connectionTimeoutMillis, hooks = {}) {
  if (!Number.isSafeInteger(connectionTimeoutMillis) || connectionTimeoutMillis < 1 || connectionTimeoutMillis > 2147483647) {
    throw new Error('некорректный таймаут подключения и ожидания освобождения БД')
  }
  const targetUrl = new URL(connectionString)
  if (!['postgres:', 'postgresql:'].includes(targetUrl.protocol) || !targetUrl.hostname || targetUrl.searchParams.has('host') || targetUrl.searchParams.has('dbname')) {
    throw new Error('URL базы не позволяет однозначно определить целевую БД')
  }
  const database = decodeURIComponent(targetUrl.pathname.replace(/^\//, ''))
  if (!database || database === 'postgres' || database.includes('/') || database.includes('\0')) {
    throw new Error('для сброса нужна отдельная целевая БД, не postgres')
  }
  const config = (url) => ({ connectionString: url, connectionTimeoutMillis })

  let control, target
  let targetTransaction = false
  let commitStarted = false
  let committed = false
  let result
  let originalError
  let interrupted = false
  const onSignal = () => {
    interrupted = true
    // Закрыть соединения обязательно: ожидающий промис сам по себе событийный
    // цикл не держит, поэтому без этого процесс после SIGTERM не завершится.
    // Закрытие до COMMIT роллбэчит транзакцию на сервере — данные остаются целы.
    // Во время COMMIT соединение не трогаем: иначе исход фиксации станет неизвестен.
    if (!commitStarted) {
      target?.end().catch(() => {})
      control?.end().catch(() => {})
    }
  }
  process.once('SIGTERM', onSignal); process.once('SIGINT', onSignal)
  try {
    control = new pg.Client(config(targetUrl.toString())); control.on('error', () => {}); await control.connect()
    const info = await control.query("SELECT oid::text, datallowconn, pg_has_role(current_user, datdba, 'USAGE') AS can_alter FROM pg_database WHERE datname=$1", [database])
    if (info.rows.length !== 1) throw new Error('целевая БД не найдена')
    if (!info.rows[0].datallowconn) throw new Error('подключения к целевой БД отключены; требуется восстановление владельцем')
    if (!info.rows[0].can_alter) throw new Error('роль сброса не владеет целевой БД; безопасный сброс невозможен')

    target = new pg.Client(config(targetUrl.toString())); target.on('error', () => {}); await target.connect()
    hooks.onTarget?.(target)

    // Два соединения к одной базе всё равно нужны: так проверяется, что обе строки
    // ведут на один сервер и одну базу. Через pooler соединения попадают на разные
    // бэкенды, и сброс по такому адресу небезопасен — проверка это ловит.
    const identity = await target.query('SELECT current_database() AS name, (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid, inet_server_addr()::text AS address, inet_server_port() AS port')
    const controlIdentity = await control.query('SELECT inet_server_addr()::text AS address, inet_server_port() AS port')
    if (identity.rows[0]?.name !== database || identity.rows[0]?.oid !== info.rows[0].oid || identity.rows[0]?.address !== controlIdentity.rows[0]?.address || identity.rows[0]?.port !== controlIdentity.rows[0]?.port) {
      throw new Error('контрольное подключение не подтверждает тот же сервер и базу')
    }
    if (interrupted) throw new Error('сброс прерван до начала')

    await target.query('BEGIN'); targetTransaction = true
    await target.query(`SET LOCAL lock_timeout = ${connectionTimeoutMillis}`)
    // Пока держим эту блокировку, `sync` ни на одном инстансе не пройдёт.
    await target.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [SYNC_LOCK_KEY])
    const acquired = await target.query("SELECT pg_try_advisory_xact_lock(hashtext($1)::bigint) AS ok", [`modals-kit:exclusive-reset:${database}`])
    if (!acquired.rows[0]?.ok) throw new Error('другой сброс базы уже выполняется')
    const prepared = await control.query('SELECT gid FROM pg_prepared_xacts WHERE database=$1 LIMIT 1', [database])
    if (prepared.rows.length) throw new Error('в целевой БД есть подготовленные транзакции; сброс остановлен')
    if (interrupted) throw new Error('сброс прерван до начала DDL')

    await hooks.afterExclusive?.({ control, target, database })
    result = await resetPublicObjects(target, { transactionStarted: true })
    if (interrupted) throw new Error('сброс прерван до фиксации')
    commitStarted = true
    await target.query('COMMIT'); targetTransaction = false; committed = true
  } catch (error) {
    originalError = error
    if (targetTransaction) await target?.query('ROLLBACK').catch(() => {})
  } finally {
    await target?.end().catch(() => {})
    await control?.end().catch(() => {})
    process.removeListener('SIGTERM', onSignal); process.removeListener('SIGINT', onSignal)
  }
  if (originalError) {
    if (commitStarted && !committed) throw new Error('исход COMMIT неизвестен; проверьте состояние базы до повторного сброса', { cause: originalError })
    throw originalError
  }
  return result
}
