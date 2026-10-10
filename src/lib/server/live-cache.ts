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
 *   • TTL 1500 мс — меньше интервала опроса (2 с): максимум, на который 304 может
 *     задержать уже случившуюся строку, — один пропущенный тик, а не «пока не
 *     перезагрузишься»;
 *   • любая запись в демо поднимает `generation`, и все записи памяти до неё
 *     считаются недействительными сразу — не «когда истечёт TTL».
 *
 * Память на процесс: на нескольких инстансах у каждого своя, и потеря равна
 * одному лишнему 200 — не ошибке. Хранится ОДНА строка на ключ (отпечаток), тело
 * не держим: у 304 тела нет.
 */
const TTL_MS = 1_500
const MAX_ENTRIES = 64

type Entry = { etag: string; at: number; generation: number }

const entries = new Map<string, Entry>()
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

/** Отпечаток страницы: по тем же байтам, что уходят клиенту. */
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
  const entry = entries.get(key)
  if (!entry) return null
  if (entry.generation !== generation || now - entry.at > TTL_MS) {
    entries.delete(key)
    return null
  }
  return etagMatches(header, entry.etag) ? entry.etag : null
}

export function remember(key: string, etag: string, now = Date.now()): void {
  if (entries.size >= MAX_ENTRIES && !entries.has(key)) {
    // Вытеснение «самого старого», а не «первого попавшегося»: Map хранит порядок
    // вставки, и этого достаточно — точный LRU здесь стоит дороже, чем даёт.
    const oldest = entries.keys().next()
    if (!oldest.done) entries.delete(oldest.value)
  }
  entries.set(key, { etag, at: now, generation })
}

/** Только для проб и самопроверки: сколько ключей держится в памяти. */
export const liveCacheSize = (): number => entries.size
