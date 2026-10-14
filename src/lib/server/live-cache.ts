/**
 * Короткая память условного GET для `/api/db-posts`.
 *
 * Без неё «304» — вежливая ложь: маршрут сначала читает страницу из базы, а потом
 * сообразительным сравнением отвечает «не изменилось». С ней тик живого списка, на
 * котором ничего не появилось, до базы вообще не доходит.
 *
 * Что делает это безопасным, а не «кэшем на глаз»:
 *   • спрашивается ТОЛЬКО условный запрос (с `If-None-Match`). Обычный GET — всегда
 *     свежее чтение, иначе навигация после записи показала бы прошлое;
 *   • TTL 5000 мс — 2,5 интервала опроса (2 с). Память пишется только ответом
 *     200, а 304 её срок НЕ продлевает (иначе устаревание на соседнем инстансе
 *     было бы неограниченным). При TTL короче интервала каждый тик промахивался
 *     бы мимо памяти и шёл в базу — то есть 304 не экономил ничего; при 2,5
 *     интервала из трёх тиков без изменений два обходятся без базы;
 *   • любая запись в демо поднимает `generation`, и все записи памяти до неё
 *     считаются недействительными сразу — не «когда истечёт TTL».
 *
 * Память на процесс (`localStore`, а не общее хранилище: смысл 304 — ответить без
 * ввода-вывода, поход по сети съел бы выигрыш). На нескольких инстансах у каждого
 * своя память, и запись на одном не сбрасывает память другого: тот может ответить
 * устаревшим 304, но не дольше TTL (5 с — два-три тика опроса), либо лишним 200.
 * Хранится ОДНА строка на ключ (отпечаток), тело не держим: у 304 тела нет.
 */
import { localStore } from '#lib/server/cache.js'

export const LIVE_CACHE_TTL_MS = 5_000
const TTL_MS = LIVE_CACHE_TTL_MS
const MAX_ENTRIES = 64

type Entry = { etag: string; at: number; generation: number }

// Потолок и вытеснение «самого старого» — у области хранилища.
const entries = localStore.scope('live-cache:db-posts', { max: MAX_ENTRIES })
let generation = 0

/** Вызывается из приёмной формы после `commit()`: с этого мгновения память пуста. */
export function invalidateLiveCache(): void {
  generation += 1
  entries.clear()
}

/** Сверка `If-None-Match` по RFC 7232: слабое и сильное представление равны, `*` — любой. */
export function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false
  if (header.trim() === '*') return true
  const bare = (v: string): string => v.trim().replace(/^W\//, '')
  return header.split(',').some((v) => bare(v) === bare(etag))
}

/**
 * Текст для отпечатка — ответ БЕЗ указателя `extra.after`. Токен подписывается
 * заново на каждый запрос (в нём срок жизни), поэтому отпечаток «всего тела»
 * менялся на каждом тике курсорного режима, и живой список видел «новое» там,
 * где не изменилось ни одной строки. Отпечаток обязан следовать за ДАННЫМИ:
 * строки, счётчики и `hasNext` входят, подпись — нет. Старый токен у клиента
 * при этом остаётся годным до своего срока (`DB_CURSOR_TTL_SECONDS`).
 */
export function stableText(page: object): string {
  const { extra, ...data } = page as { extra?: Record<string, unknown> }
  if (!extra) return JSON.stringify(data)
  const { after: _signed, ...rest } = extra
  return JSON.stringify(Object.keys(rest).length ? { ...data, extra: rest } : data)
}

/** Отпечаток текста (обычно — `stableText` ответа). */
export async function fingerprint(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return `W/"${[...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')}"`
}

/**
 * «Можно ответить 304?» — да, если под этот же ключ недавно отдавали ровно этот
 * отпечаток, он не устарел по времени и не перечёркнут записью. Возвращает отпечаток
 * для эха (304 обязан его нести) либо `null`.
 */
export function revalidate(key: string, header: string | null, now = Date.now()): string | null {
  const entry = entries.get<Entry>(key)
  if (!entry) return null
  if (entry.generation !== generation || now - entry.at > TTL_MS) {
    entries.delete(key)
    return null
  }
  return etagMatches(header, entry.etag) ? entry.etag : null
}

export function remember(key: string, etag: string, now = Date.now()): void {
  // Срок хранилища — уборка; решает проверка `now - at` в `revalidate`.
  entries.set<Entry>(key, { etag, at: now, generation }, TTL_MS)
}

/** Только для проб и самопроверки: сколько ключей держится в памяти. */
export const liveCacheSize = (): number => entries.size
