/**
 * P1-8: воспроизводимый замер серверного набора отзыва на PGlite.
 *
 * Гоняет НАСТОЯЩИЙ `revokeBulkSessions` (не копию цикла) на срезе 5000 строк:
 *  - baseline: весь активный срез, без исключений;
 *  - except=500: предел домена/формы, исключения объявленным оператором.
 *
 * Драйвер оборачивается наблюдателем: считает SQL по классам (count / page /
 * delete), время транзакции и длину SQL. Режим `capture` исполняет `count`,
 * а первый `page-select` подменяет пустым ответом — так снимается точный SQL
 * продакшн-фильтра БЕЗ удаления строк, и по нему сразу делается EXPLAIN
 * ANALYZE на живом срезе. Затем сценарий гоняется вживую несколько раз.
 *
 * Запуск: npm run probe:user:sessions-bulk
 * Переменные: PROBE_ROWS (5000), PROBE_RUNS (3), PROBE_EXCEPT (500).
 */
import { PGlite } from '@electric-sql/pglite'
import { conservativeLimits, createDb, type Database, type Driver, type QueryResult, type Row, type Statement } from '#lib/db/index.js'
import { pgliteAdapter } from '#lib/db/adapters/pglite.js'
import { defineSchema } from '#lib/db/sync/index.js'
import { SERVER } from '../auth.ts'
import { auth, session } from '../schema.ts'
import { revokeBulkSessions, type SessionActor } from '../sessions.server.ts'
import { SESSIONS_BULK_IDS_LIMIT } from '../types.ts'

const ROWS = Number(process.env.PROBE_ROWS ?? 5000)
const RUNS = Number(process.env.PROBE_RUNS ?? 3)
const EXCEPT = Number(process.env.PROBE_EXCEPT ?? SESSIONS_BULK_IDS_LIMIT)
const NOW = Date.parse('2026-11-13T12:00:00.000Z')

type Kind = 'count' | 'page' | 'delete' | 'insert' | 'other'
interface Rec { kind: Kind; text: string; values: readonly unknown[]; ms: number; rows: number }

function classify(text: string): Kind {
  const t = text.trim()
  if (/count\(\*\)/i.test(t)) return 'count'
  if (/^select/i.test(t) && /user_session/i.test(t) && /\blimit\b/i.test(t)) return 'page'
  if (/^update/i.test(t) && /user_session/i.test(t)) return 'delete'
  if (/^insert/i.test(t)) return 'insert'
  return 'other'
}

function instrument(base: Driver) {
  const records: Rec[] = []
  let mode: 'normal' | 'capture' = 'normal'
  let txMs = 0
  let txCount = 0
  const wrapQuery = (d: Driver) => async <T extends Row>(s: Statement): Promise<QueryResult<T>> => {
    const kind = classify(s.text)
    const t0 = performance.now()
    if (mode === 'capture' && kind === 'page') {
      records.push({ kind, text: s.text, values: s.values ?? [], ms: 0, rows: 0 })
      return { rows: [], rowCount: 0 } as QueryResult<T>
    }
    const r = await d.query<T>(s)
    records.push({ kind, text: s.text, values: s.values ?? [], ms: performance.now() - t0, rows: r.rows.length })
    return r
  }
  const wrap = (d: Driver): Driver => ({
    capabilities: d.capabilities,
    inTransaction: d.inTransaction,
    query: wrapQuery(d),
    transaction: (fn, opts) => d.transaction((tx) => fn(wrap(tx)), opts),
  })
  const driver: Driver = {
    capabilities: base.capabilities,
    query: wrapQuery(base),
    transaction: async (fn, opts) => {
      txCount += 1
      const t0 = performance.now()
      try { return await base.transaction((tx) => fn(wrap(tx)), opts) }
      finally { txMs += performance.now() - t0 }
    },
  }
  return {
    driver,
    records,
    get txMs() { return txMs },
    get txCount() { return txCount },
    reset() { records.length = 0; txMs = 0; txCount = 0 },
    setMode(m: 'normal' | 'capture') { mode = m },
  }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const r1 = (x: number) => Math.round(x * 10) / 10

async function explain(pg: PGlite, rec: Rec, analyze: boolean): Promise<string[]> {
  const sql = analyze ? `EXPLAIN (ANALYZE, BUFFERS) ${rec.text}` : `EXPLAIN ${rec.text}`
  const r = await pg.query(sql, [...rec.values])
  return r.rows.map((row) => String((row as Record<string, unknown>)['QUERY PLAN']))
}

async function main() {
  const pg = new PGlite()
  const instr = instrument(pgliteAdapter(pg))
  const resources = [auth, session]
  const sync = await defineSchema({ resources }).sync(instr.driver)
  if (sync.status !== 'ok') throw new Error(`schema sync: ${sync.status}`)
  const db: Database = createDb({ driver: instr.driver, limits: conservativeLimits, resources })

  const me = String((await db.resource(auth).insert(SERVER, { seed: 'a'.repeat(43) })).id)
  const actor: SessionActor = { id: me, permissions: [], sessionId: null }

  async function reseed(n: number) {
    await pg.exec('TRUNCATE public.user_session')
    await pg.query(
      `INSERT INTO public.user_session (auth_id, jti, device_name, country, subnet_history, expires_at, last_seen_at)
       SELECT $1, 'probe-bulk-session-jti-' || lpad(i::text, 5, '0'), 'probe', 'RU', '[]'::jsonb,
              to_timestamp($3 / 1000.0) + interval '1 hour', to_timestamp($3 / 1000.0)
       FROM generate_series(1, $2) AS i`,
      [me, n, NOW],
    )
  }
  async function ids(limit: number): Promise<string[]> {
    const r = await pg.query('SELECT id FROM public.user_session WHERE auth_id = $1 ORDER BY id LIMIT $2', [me, limit])
    return r.rows.map((row) => String((row as Record<string, unknown>).id))
  }

  async function scenario(name: string, exceptCount: number) {
    // Каждый прогон — свежий срез; id исключений снимаются ПОСЛЕ reseed,
    // иначе UUID нового среза не совпадут с исключениями прошлого.
    const argsFor = async () => ({
      where: { state: 'active' as const },
      includeCurrent: true,
      except: exceptCount ? await ids(exceptCount) : [],
    })

    await reseed(ROWS)
    // Точный SQL продакшн-фильтра без удаления + EXPLAIN ANALYZE на живом срезе.
    instr.reset(); instr.setMode('capture')
    let captureError: string | null = null
    try { await revokeBulkSessions(actor, await argsFor(), { db, now: NOW }) }
    catch (e) { captureError = e instanceof Error ? `${e.name}: ${e.message}` : String(e) }
    instr.setMode('normal')
    const countRec = instr.records.find((r) => r.kind === 'count') ?? null
    const pageRec = instr.records.find((r) => r.kind === 'page') ?? null
    const plans: Record<string, unknown> = {}
    if (countRec) plans.count = { sqlChars: countRec.text.length, params: countRec.values.length, explain: await explain(pg, countRec, true) }
    if (pageRec) plans.page = { sqlChars: pageRec.text.length, params: pageRec.values.length, explain: await explain(pg, pageRec, true) }

    // Живые прогоны: перед каждым — свежий срез и свои id исключений.
    const runs: Record<string, number | boolean>[] = []
    let deletePlan: string[] | null = null
    let firstError: string | null = null
    for (let i = 0; i < RUNS; i++) {
      await reseed(ROWS)
      const args = await argsFor()
      instr.reset()
      const t0 = performance.now()
      try {
        const r = await revokeBulkSessions(actor, args, { db, now: NOW })
        const wall = performance.now() - t0
        if (!r.ok) { firstError = r.fact.code; runs.push({ ok: false }); continue }
        const expectedRevoked = ROWS - exceptCount
        if (r.value.revoked !== expectedRevoked || r.value.requested !== expectedRevoked) {
          firstError = `revoked=${r.value.revoked} requested=${r.value.requested}, expected ${expectedRevoked}`
          runs.push({ ok: false }); continue
        }
        const recs = instr.records
        const del = recs.find((x) => x.kind === 'delete')
        if (del && !deletePlan) deletePlan = await explain(pg, del, false)
        runs.push({
          ok: true,
          requested: r.value.requested,
          revoked: r.value.revoked,
          current: r.value.current,
          wallMs: r1(wall),
          txMs: r1(instr.txMs),
          txCount: instr.txCount,
          iterations: recs.filter((x) => x.kind === 'page').length,
          deletes: recs.filter((x) => x.kind === 'delete').length,
          countMs: r1(sum(recs.filter((x) => x.kind === 'count').map((x) => x.ms))),
          pageMs: r1(sum(recs.filter((x) => x.kind === 'page').map((x) => x.ms))),
          deleteMs: r1(sum(recs.filter((x) => x.kind === 'delete').map((x) => x.ms))),
          countSqlChars: recs.find((x) => x.kind === 'count')?.text.length ?? 0,
          pageSqlChars: recs.find((x) => x.kind === 'page')?.text.length ?? 0,
          deleteSqlChars: del?.text.length ?? 0,
        })
      } catch (e) {
        firstError = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
        runs.push({ ok: false })
      }
    }
    const okRuns = runs.filter((r) => r.ok === true)
    const med = (k: string) => okRuns.length ? r1(median(okRuns.map((r) => Number(r[k])))) : null
    return {
      name, rows: ROWS, except: exceptCount, runs,
      median: okRuns.length ? {
        wallMs: med('wallMs'), txMs: med('txMs'), iterations: med('iterations'), deletes: med('deletes'),
        countMs: med('countMs'), pageMs: med('pageMs'), deleteMs: med('deleteMs'),
        countSharePct: med('countMs') !== null && med('txMs') ? r1(100 * (med('countMs')! / med('txMs')!)) : null,
      } : null,
      captureError, firstError, plans, deletePlan,
    }
  }

  const baseline = await scenario('baseline', 0)
  const withExcept = await scenario('except', EXCEPT)
  await pg.close()

  const report = { node: process.version, pglite: 'in-memory', limits: conservativeLimits, rows: ROWS, runs: RUNS, exceptLimit: SESSIONS_BULK_IDS_LIMIT, baseline, withExcept }
  console.log(JSON.stringify(report, null, 2))
  const failed = [baseline, withExcept].filter((s) => s.captureError || s.firstError || !s.median)
  if (failed.length) {
    console.error('PROBE FAIL: ' + failed.map((s) => `${s.name}: ${s.captureError ?? s.firstError}`).join('; '))
    process.exitCode = 1
  } else {
    console.error('PROBE OK')
  }
}

await main()
