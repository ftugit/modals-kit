/**
 * Предразвёртывание БД из `DATABASE_URL` на этапе сборки (`npm run build`).
 *
 * Запускается ПОСЛЕ успешного `vite build`, чтобы упавшая сборка никогда не
 * сносила и не трогала рабочую базу:
 * 1. Если задан `DATABASE_RESET=1` (`1`/`true`/`yes`) — сносит и пересоздаёт
 *    схему `public` (один раз на деплой, без гонок холодных инстансов).
 * 2. Всегда при непустом `DATABASE_URL` — поднимает схему всех моделей,
 *    начальные SQL-шаги и первого seed-администратора (`bootstrapDatabase`).
 *    Благодаря этому в Build Logs деплоя сразу видны и `[db-reset]`, и `[db]`,
 *    и ключ администратора `[user]`, а первому посетителю сайта не приходится
 *    ждать миграций на холодном старте.
 *
 * Без `DATABASE_URL` локальная сборка и CI завершаются мгновенно (а при
 * `VERCEL=1` в лог пишется явная подсказка, почему шаг пропущен).
 */
import pg from 'pg'

const resetFlag = /^(1|true|yes)$/i.test((process.env.DATABASE_RESET ?? '').trim())
// Значение env в панелях иногда вставляют в кавычках или с пробелами —
// pg такую оболочку разбирает молча и криво (host «base»), срезаем её.
const url = (process.env.DATABASE_URL ?? '').trim().replace(/^["']+|["']+$/g, '')

if (!url) {
  if (resetFlag) {
    console.warn('[db-reset] DATABASE_RESET задан, но DATABASE_URL пуст — очищать и разворачивать нечего, пропускаю')
  } else if (process.env.VERCEL) {
    console.log('[db-build] DATABASE_URL не задан в окружении сборки — предразвёртывание БД пропущено')
  }
  process.exit(0)
}

const rawTimeout = Number((process.env.DB_CONNECT_TIMEOUT_MS ?? '').trim())
const connectionTimeoutMillis =
  Number.isSafeInteger(rawTimeout) && rawTimeout >= 1 ? rawTimeout : 30_000

if (resetFlag) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis })
  try {
    await client.connect()
    await client.query('DROP SCHEMA public CASCADE').catch(() => {
      // Схемы ещё нет (первый деплой на пустую базу) — чистить нечего.
    })
    await client.query('CREATE SCHEMA public')
    const { rows } = await client.query('SELECT current_database() AS db')
    console.log(`[db-reset] схема public базы «${rows[0].db}» очищена при сборке`)
  } catch (e) {
    console.error(
      '[db-reset] очистить базу из DATABASE_URL не удалось:',
      String(e?.message ?? e).slice(0, 300),
    )
    process.exit(1)
  } finally {
    await client.end().catch(() => {})
  }
}

const { register } = await import('tsx/esm/api')
const unregister = register()
let closePool = async () => {}

try {
  const [{ openPgPool }, { bootstrapDatabase }] = await Promise.all([
    import('#lib/db/sveltekit/node.js'),
    import('#server/db-spec.server.js'),
  ])
  const pool = openPgPool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis,
  })
  closePool = pool.close
  await bootstrapDatabase(pool.driver, { logExistingAdmin: true })
} catch (e) {
  const msg = String(e?.message ?? e).slice(0, 300)
  if (resetFlag) {
    console.error('[db-build] развернуть схему и сиды после сброса не удалось:', msg)
    process.exitCode = 1
  } else {
    console.warn(
      '[db-build] предразвёртывание БД при сборке пропущено (выполнится при первом запросе в рантайме):',
      msg,
    )
  }
} finally {
  await closePool().catch(() => {})
  unregister()
}
