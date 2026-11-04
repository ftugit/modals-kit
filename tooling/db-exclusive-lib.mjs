import pg from 'pg'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resetPublicObjects } from './db-reset-lib.mjs'

const quote = (value) => `"${value.replaceAll('"', '""')}"`

/**
 * Dedicated PostgreSQL only. Requires database-owner ALTER DATABASE rights.
 * Existing target sessions are never terminated: block new connections, wait for
 * every old session to close voluntarily, then reset. If they do not drain within
 * connectionTimeoutMillis, fail before reset and restore connectivity. The
 * `/postgres` maintenance connection is deliberately separate from the target.
 *
 * A process/platform hard kill between disabling and restoring connections can
 * leave the database disabled; no in-process finally can eliminate that risk.
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
  const maintenanceUrl = new URL(targetUrl); maintenanceUrl.pathname = '/postgres'
  const config = (url) => ({ connectionString: url, connectionTimeoutMillis })
  const lock = new pg.Client(config(maintenanceUrl.toString()))
  lock.on('error', () => {})
  let control, target, probe
  let targetTransaction = false
  let mayNeedRestore = false
  let commitStarted = false
  let committed = false
  let result
  let originalError
  let restoreError
  let interrupted = false
  let disabling
  let signalRecovery
  let watchdog
  const onSignal = () => {
    interrupted = true
    // Restoration must not depend on an application callback or a stalled query.
    signalRecovery ??= (async () => {
      await target?.end().catch(() => {})
      await disabling?.catch(() => {})
      if (mayNeedRestore) {
        const rescue = new pg.Client(config(maintenanceUrl.toString()))
        rescue.on('error', () => {})
        try { await rescue.connect(); await rescue.query(`ALTER DATABASE ${quote(database)} ALLOW_CONNECTIONS true`) }
        catch { process.exitCode = 1 }
        finally { await rescue.end().catch(() => {}) }
      }
      await control?.end().catch(() => {})
      await lock.end().catch(() => {})
      if (watchdog && watchdog.exitCode === null && !watchdog.stdin.destroyed) {
        const exited = new Promise((resolve) => watchdog.once('exit', resolve))
        watchdog.stdin.end(process.exitCode ? undefined : 'safe\n')
        await exited
      }
      if (!process.exitCode) process.exitCode = 1
    })()
  }
  process.once('SIGTERM', onSignal); process.once('SIGINT', onSignal)
  try {
    await lock.connect()
    await lock.query('BEGIN')
    const acquired = await lock.query("SELECT pg_try_advisory_xact_lock(hashtext($1)::bigint) AS ok", [`modals-kit:exclusive-reset:${database}`])
    if (!acquired.rows[0]?.ok) throw new Error('другой сброс базы уже выполняется')
    control = new pg.Client(config(maintenanceUrl.toString())); control.on('error', () => {}); await control.connect()
    const info = await control.query('SELECT oid::text, datallowconn FROM pg_database WHERE datname=$1', [database])
    if (info.rows.length !== 1) throw new Error('целевая БД не найдена')
    if (!info.rows[0].datallowconn) throw new Error('подключения к целевой БД отключены; требуется восстановление владельцем')
    target = new pg.Client(config(targetUrl.toString())); target.on('error', () => {}); await target.connect()
    hooks.onTarget?.(target)
    await target.query('BEGIN'); targetTransaction = true
    const identity = await target.query('SELECT current_database() AS name, (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid, pg_backend_pid() AS pid, inet_server_addr()::text AS address, inet_server_port() AS port')
    const controlIdentity = await control.query('SELECT inet_server_addr()::text AS address, inet_server_port() AS port')
    if (identity.rows[0]?.name !== database || identity.rows[0]?.oid !== info.rows[0].oid || identity.rows[0]?.address !== controlIdentity.rows[0]?.address || identity.rows[0]?.port !== controlIdentity.rows[0]?.port) {
      throw new Error('контрольное подключение не подтверждает тот же сервер и базу')
    }
    if (interrupted) throw new Error('сброс прерван до блокировки подключений')
    watchdog = spawn(process.execPath, [fileURLToPath(new URL('./db-reset-watchdog.mjs', import.meta.url))], {
      env: { ...process.env, KIT_RESET_WATCHDOG_URL: maintenanceUrl.toString(), KIT_RESET_WATCHDOG_DATABASE: database, KIT_RESET_WATCHDOG_CONNECT_TIMEOUT: String(connectionTimeoutMillis) },
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    watchdog.on('error', () => {})
    watchdog.stdin.on('error', () => {})
    await new Promise((resolve, reject) => {
      let out = ''
      watchdog.stdout.on('data', (chunk) => { out += chunk; if (out.includes('READY\n')) resolve() })
      watchdog.once('exit', () => reject(new Error('не запущен процесс восстановления БД')))
      watchdog.once('error', reject)
    })
    if (interrupted || watchdog.exitCode !== null) throw new Error('сброс прерван до блокировки подключений')
    // Even a lost response to ALTER can mean the flag changed: always restore.
    mayNeedRestore = true
    disabling = control.query(`ALTER DATABASE ${quote(database)} ALLOW_CONNECTIONS false`)
    await disabling
    const assertNoPrepared = async () => {
      const prepared = await control.query('SELECT gid FROM pg_prepared_xacts WHERE database=$1 LIMIT 1', [database])
      if (prepared.rows.length) throw new Error('в целевой БД есть подготовленные транзакции; сброс остановлен')
    }
    await assertNoPrepared()
    await hooks.afterDisabled?.({ control, target, database })
    // An idle connection may begin a transaction even after ALLOW_CONNECTIONS
    // becomes false. Waiting merely for state='idle' and then killing it is a
    // TOCTOU race; require all old backends to CLOSE without terminating them.
    // Reuse the existing connection timeout as the maximum drain wait, rather
    // than introducing a new, unapproved numeric production limit.
    const drainDeadline = performance.now() + connectionTimeoutMillis
    for (;;) {
      if (interrupted) throw new Error('сброс прерван')
      const others = await control.query('SELECT pid, backend_type FROM pg_stat_activity WHERE datname=$1 AND pid <> $2', [database, identity.rows[0].pid])
      if (others.rows.some((row) => row.backend_type !== 'client backend')) throw new Error('целевая БД занята системными процессами; сброс остановлен')
      if (!others.rows.length) break
      const remainingMs = drainDeadline - performance.now()
      if (remainingMs <= 0) throw new Error('прежние подключения не закрылись вовремя; сброс не начат')
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, remainingMs)))
    }
    // A session can PREPARE during the drain and then disconnect. Recheck after
    // the last backend leaves; prepared transactions persist without a backend.
    await assertNoPrepared()
    const admission = await control.query('SELECT datallowconn FROM pg_database WHERE datname=$1', [database])
    if (admission.rows.length !== 1 || admission.rows[0].datallowconn) throw new Error('запрет новых подключений снят; сброс остановлен')
    if (interrupted) throw new Error('сброс прерван')
    await hooks.afterExclusive?.({ control, target, database })
    result = await resetPublicObjects(target, { transactionStarted: true })
    if (interrupted || watchdog.exitCode !== null) throw new Error('сброс прерван до фиксации')
    commitStarted = true
    await target.query('COMMIT'); targetTransaction = false; committed = true
  } catch (error) {
    originalError = error
    if (targetTransaction) await target?.query('ROLLBACK').catch(() => {})
  } finally {
    if (mayNeedRestore) {
      try {
        // A lost control connection must not prevent a fresh restoration attempt.
        if (!control || control._ending || control._ended) {
          control = new pg.Client(config(maintenanceUrl.toString())); control.on('error', () => {}); await control.connect()
        }
        try { await control.query(`ALTER DATABASE ${quote(database)} ALLOW_CONNECTIONS true`) }
        catch {
          await control.end().catch(() => {})
          control = new pg.Client(config(maintenanceUrl.toString())); control.on('error', () => {}); await control.connect()
          await control.query(`ALTER DATABASE ${quote(database)} ALLOW_CONNECTIONS true`)
        }
        const enabled = await control.query('SELECT datallowconn FROM pg_database WHERE datname=$1', [database])
        if (!enabled.rows[0]?.datallowconn) throw new Error('подключения не восстановлены')
      } catch (error) { restoreError = error }
    }
    await target?.end().catch(() => {})
    await control?.end().catch(() => {})
    await lock.query('ROLLBACK').catch(() => {})
    await lock.end().catch(() => {})
    if (signalRecovery) await signalRecovery
    if (watchdog && watchdog.exitCode === null && !watchdog.stdin.destroyed) {
      const exited = new Promise((resolve) => watchdog.once('exit', resolve))
      watchdog.stdin.end(restoreError ? undefined : 'safe\n')
      await exited
    }
    process.removeListener('SIGTERM', onSignal); process.removeListener('SIGINT', onSignal)
  }
  if (restoreError) throw new Error('подключения к БД не восстановлены автоматически; срочно обратитесь к владельцу БД', { cause: restoreError })
  if (originalError) {
    if (commitStarted && !committed) throw new Error('исход COMMIT неизвестен; проверьте состояние базы до повторного сброса', { cause: originalError })
    throw originalError
  }
  if (committed) {
    try {
      probe = new pg.Client(config(targetUrl.toString())); await probe.connect(); await probe.query('SELECT 1')
    } catch (error) {
      throw new Error('сброс зафиксирован, но подключение после восстановления не подтверждено', { cause: error })
    } finally { await probe?.end().catch(() => {}) }
  }
  return result
}
