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
 *
 * Фильтры не исключение из этого правила: браузер отправляет значения в
 * канонических ключах (`filters.<поле>[.<режим>]`), а применяет их СЕРВЕР
 * (`$lib/server/shikimori-filters`) по живой схеме источника; готовая схема
 * приезжает роутом `/api/shikimori/filters` (`getShikimoriFilters`).
 */
import { validateCatalogFilterSchema, type CatalogFilterSchema } from '$lib/filters'

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
  /**
   * Значения фильтров в КАНОНИЧЕСКИХ ключах схемы: `filters.genres.and`,
   * `filters.score.min`, `filters.kind`, … Применяет их сервер (роут или
   * серверный транспорт) по живой схеме — клиент ничего не «до-считает».
   */
  filters?: Readonly<Record<string, unknown>>
  signal?: AbortSignal
}

export type AnimesPage = {
  items: AnimeCard[]
  page: number
  limit: number
  hasNext: boolean
  /** Ответ отдан из серверного кэша (вежливость к API) — для панели/отладки. */
  cached?: boolean
  /**
   * Что сервер НЕ применил и почему (связка запретила поиск, значение вне схемы):
   * молчание запрещено — причина доезжает до потребителя.
   */
  dropped?: readonly { key: string; reason: string }[]
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
export async function getAnimesPage({ page, limit, search, filters, signal }: AnimesQuery): Promise<AnimesPage> {
  if (typeof window === 'undefined') {
    throw new Error('[shikimori] живой источник запрашивается только из браузера')
  }
  // Фильтры едут в СВОИХ канонических ключах (`filters.<поле>[.<режим>]`) — тот
  // же формат, что в адресе: один словарь имён на адрес, extra и запрос.
  const params: Record<string, string | number | undefined> = { page, limit, search }
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (value === undefined || value === null || value === '') continue
    params[key] = Array.isArray(value) ? value.join(',') : String(value)
  }
  const res = await fetch(apiUrl('/api/shikimori/animes', params), { signal })
  if (!res.ok) {
    const detail = await res
      .json()
      .then((body: { error?: string }) => body?.error)
      .catch(() => null)
    throw new Error(`Shikimori API: ${detail ?? res.status}`)
  }
  return (await res.json()) as AnimesPage
}

/**
 * Готовая схема фильтров с нашего бэкенда: значения и связки собраны в ЗОНЕ
 * ИСТОЧНИКА (по живым справочникам, с меткой `builtAt`), клиент её лишь читает
 * и проверяет своим же валидатором — «вычислить схему на клиенте» здесь нельзя
 * даже случайно, в браузер не приезжает ничего, кроме готового описания.
 */
export async function getShikimoriFilters(signal?: AbortSignal): Promise<CatalogFilterSchema> {
  const res = await fetch('/api/shikimori/filters', { signal })
  if (!res.ok) {
    const detail = await res
      .json()
      .then((body: { error?: string }) => body?.error)
      .catch(() => null)
    throw new Error(`Схема фильтров Shikimori недоступна: ${detail ?? res.status}`)
  }
  return validateCatalogFilterSchema(await res.json())
}

/** Артефакт словаря коррекции (`display\tdf`) с нашего бэкенда. */
export async function getShikimoriTerms(signal?: AbortSignal): Promise<string> {
  const res = await fetch('/api/shikimori/terms', { signal })
  if (!res.ok) throw new Error(`Словарь Shikimori недоступен: ${res.status}`)
  return await res.text()
}
