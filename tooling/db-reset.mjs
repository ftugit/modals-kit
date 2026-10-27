/**
 * Очистка базы из `DATABASE_URL` при СБОРКЕ (`npm run build`), не в рантайме.
 *
 * Почему именно сборка: на serverless рантайм-очистка срабатывала бы на
 * каждом холодном инстансе — несколько копий приложения сносили бы схему
 * друг у друга наживую. Сборка же одна на деплой: снесла схему `public`,
 * дальше первый запрос разворачивает модели, сиды и администратора на
 * пустом месте (`schema.gate` в `src/server/db.server.ts`).
 *
 * Включается отдельным env `DATABASE_RESET=1` (1/true/yes). Без флага или
 * без `DATABASE_URL` — тихий пропуск: локальная сборка и CI базу не трогают.
 * Не удалось подключиться при заданном флаге — сборка падает: деплой со
 * старой базой вместо обещанной чистой хуже, чем красный билд.
 */
import pg from 'pg'

const flag = /^(1|true|yes)$/i.test((process.env.DATABASE_RESET ?? '').trim())
if (!flag) process.exit(0)

// Значение env в панелях иногда вставляют в кавычках или с пробелами —
// pg такую оболочку разбирает молча и криво (host «base»), срезаем её.
const url = (process.env.DATABASE_URL ?? '').trim().replace(/^["']+|["']+$/g, '')
if (!url) {
  console.warn('[db-reset] DATABASE_RESET задан, но DATABASE_URL пуст — очищать нечего, пропускаю')
  process.exit(0)
}

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15_000 })
try {
  await client.connect()
  await client.query('DROP SCHEMA public CASCADE').catch(() => {
    // Схемы ещё нет (первый деплой на пустую базу) — чистить нечего.
  })
  await client.query('CREATE SCHEMA public')
  const { rows } = await client.query('SELECT current_database() AS db')
  console.log(`[db-reset] схема public базы «${rows[0].db}» очищена при сборке; приложение развернёт её заново`)
} catch (e) {
  console.error('[db-reset] очистить базу из DATABASE_URL не удалось:', String(e?.message ?? e).slice(0, 300))
  process.exit(1)
} finally {
  await client.end().catch(() => {})
}
