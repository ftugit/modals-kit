// Best-effort external recovery if the reset process dies after disabling logins.
// If the hosting platform kills the entire process group, an external operator
// or watchdog is still required; never claim a hard-kill guarantee.
import pg from 'pg'
const url = process.env.KIT_RESET_WATCHDOG_URL
const database = process.env.KIT_RESET_WATCHDOG_DATABASE
const timeout = Number(process.env.KIT_RESET_WATCHDOG_CONNECT_TIMEOUT)
const quote = (name) => `"${name.replaceAll('"', '""')}"`
let message = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { message += chunk; if (message.length > 16) message = 'invalid' })
process.stdin.once('end', async () => {
  if (message === 'safe\n') return
  if (!url || !database) { process.exitCode = 1; return }
  const lock = new pg.Client({ connectionString: url, connectionTimeoutMillis: timeout })
  const control = new pg.Client({ connectionString: url, connectionTimeoutMillis: timeout })
  lock.on('error', () => {}); control.on('error', () => {})
  try {
    await lock.connect(); await lock.query('BEGIN')
    await lock.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`modals-kit:exclusive-reset:${database}`])
    await control.connect(); await control.query(`ALTER DATABASE ${quote(database)} ALLOW_CONNECTIONS true`)
  } catch { process.exitCode = 1 }
  finally { await control.end().catch(() => {}); await lock.query('ROLLBACK').catch(() => {}); await lock.end().catch(() => {}) }
})
process.stdin.resume()
process.stdout.write('READY\n')
