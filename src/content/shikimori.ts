/**
 * Живой источник каталога: Shikimori API через наш бэкенд.
 *
 * Роли разделены строго:
 *   • браузер (этот модуль) ходит в СВОЙ эндпоинт `/api/shikimori/animes` и
 *     `/api/shikimori/terms` — никаких прямых обращений к внешнему API, иначе
 *     User-Agent, кэш, троттлинг и повторы оказались бы на клиенте;
 *   • сервер (`$lib/server/shikimori.ts`) ходит в `shikimori.io` напрямую.
 *
 * Контракт источника — обычный `Source<T>` пагинатора: «страница N размера M»
 * плюс `q`. `pageSize` едет в API как `limit` (максимум {@link SHIKIMORI_LIMIT_MAX}),
 * `q` — как `search` (подстрока по названиям). Полного числа страниц API не
 * отдаёт, поэтому `hasNext` — «страница заполнена целиком»; PageNav у такого
 * источника работает стрелками (канон R12).
 */

/** Максимум записей на страницу у Shikimori API: больше он молча режет до этого. */
export const SHIKIMORI_LIMIT_MAX = 50

/** Порядок выдачи каталога (единственный, который использует демо). */
export const SHIKIMORI_ORDER = 'popularity'

/** Запись каталога Shikimori (нормализованная сервером). */
export type AnimeCard = {
  id: number
  /** Романдзированное название (`name` в API). */
  name: string
  /** Русское название; null, если у тайтла его нет. */
  russian: string | null
  /** Абсолютный адрес постера (preview). */
  poster: string | null
  /** Абсолютный адрес миниатюры 48px (x48) — для строк списка. */
  thumb: string | null
  /** Абсолютная ссылка на страницу тайтла. */
  url: string
  /** tv | movie | ova | ona | special | … */
  kind: string
  /** Оценка 1–10; null, если ещё не оценён. */
  score: number | null
  /** released | ongoing | anons */
  status: string
  episodes: number
  /** Год выхода (из `aired_on`). */
  year: number | null
  airedOn: string | null
}

/** Запрос страницы у нашего бэкенда. */
export type AnimesQuery = {
  page: number
  limit: number
  search?: string
  signal?: AbortSignal
}

export type AnimesPage = {
  items: AnimeCard[]
  page: number
  limit: number
  hasNext: boolean
  /** Ответ отдан из серверного кэша (вежливость к API) — для панели/отладки. */
  cached?: boolean
}

/** Заголовок карточки: русское название, иначе романдзи. */
export function animeTitle(card: AnimeCard): string {
  return card.russian ?? card.name
}

/** Тексты карточки для fuzzy-ранжирования и словаря (романдзи + русское). */
export function animeTexts(card: AnimeCard): string[] {
  return card.russian ? [card.russian, card.name] : [card.name]
}

const KIND_LABELS: Record<string, string> = {
  tv: 'TV',
  movie: 'фильм',
  ova: 'OVA',
  ona: 'ONA',
  special: 'спешл',
  tv_special: 'TV-спешл',
  music: 'клип',
}
const STATUS_LABELS: Record<string, string> = {
  released: 'вышел',
  ongoing: 'онгоинг',
  anons: 'анонс',
}
export const animeKindLabel = (kind: string): string => KIND_LABELS[kind] ?? kind
export const animeStatusLabel = (status: string): string => STATUS_LABELS[status] ?? status

function apiUrl(path: string, params?: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== '') qs.set(k, String(v))
  }
  const s = qs.toString()
  return s ? `${path}?${s}` : path
}

/**
 * Страница каталога у нашего бэкенда. Живой источник обслуживается на клиенте:
 * SSR-снапшот для него не строится (см. loader.ts) — серверу пришлось бы
 * вызывать собственный HTTP-эндпоинт, не добавляя ничего к клиентской загрузке.
 */
export async function getAnimesPage({ page, limit, search, signal }: AnimesQuery): Promise<AnimesPage> {
  if (typeof window === 'undefined') {
    throw new Error('[shikimori] живой источник запрашивается только из браузера')
  }
  const res = await fetch(apiUrl('/api/shikimori/animes', { page, limit, search }), { signal })
  if (!res.ok) {
    const detail = await res
      .json()
      .then((body: { error?: string }) => body?.error)
      .catch(() => null)
    throw new Error(`Shikimori API: ${detail ?? res.status}`)
  }
  return (await res.json()) as AnimesPage
}

/** Артефакт словаря коррекции (`display\tdf`) с нашего бэкенда. */
export async function getShikimoriTerms(signal?: AbortSignal): Promise<string> {
  const res = await fetch('/api/shikimori/terms', { signal })
  if (!res.ok) throw new Error(`Словарь Shikimori недоступен: ${res.status}`)
  return await res.text()
}
