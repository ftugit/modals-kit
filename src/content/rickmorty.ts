/**
 * Персонажи Rick and Morty — второй живой источник демо (F54). Общая часть
 * двух зон: форма записи, запрос страницы и браузерный доступ к НАШЕМУ
 * эндпоинту `/api/rickmorty/characters` (в API сервиса браузер не ходит:
 * кэш, вежливость и разбор ошибок живут на сервере, как у Shikimori).
 *
 * У сервиса две версии одного API без ключа — REST
 * (`/api/character/?page=&name=&status=…`) и GraphQL (`characters(page,
 * filter)`). Демо держит обе как две версии ОДНОГО источника: параметры,
 * фильтры и форма записи одинаковы, различается только транспорт.
 *
 * Курсора нет ни в одной версии (проверено 2026-10-12): аргументы у
 * `characters` — только `page` и `filter`, ответ — `info { count pages next
 * prev }` с НОМЕРАМИ страниц; REST отдаёт те же номера ссылками. Поэтому режим
 * курсора у этого источника недоступен, а число страниц известно (`count`).
 */

import { responseError } from '#lib/api-error.js'
import { fetchWithTask, type StreamTask } from '#lib/fetch/index.js'

/** Версия API источника. */
export type RickMortyApi = 'rest' | 'graphql'
export const RICKMORTY_APIS: readonly RickMortyApi[] = ['rest', 'graphql']

/** Размер страницы API: фиксированный, параметра размера у сервиса нет. */
export const RICKMORTY_API_PAGE_SIZE = 20

/** Наибольший размер страницы демо: три страницы API на один запрос. */
export const RICKMORTY_LIMIT_MAX = 60

/** Персонаж (нормализованный сервером; форма одна для REST и GraphQL). */
export type RickMortyCharacter = {
  id: number
  name: string
  /** Alive | Dead | unknown — как отдаёт API. */
  status: string
  species: string
  /** Подвид; пустая строка, если не указан. */
  type: string
  /** Female | Male | Genderless | unknown. */
  gender: string
  /** Абсолютный адрес аватара 300×300. */
  image: string
}

/** Запрос страницы у нашего бэкенда. */
export type CharactersQuery = {
  api: RickMortyApi
  page: number
  limit: number
  /** Поиск по имени (подстрока): параметр `name` API. */
  search?: string
  /** Фильтры в канонических ключах схемы (`filters.status`, …). */
  filters?: Readonly<Record<string, unknown>>
  signal?: AbortSignal
  /** Ход ожидания сервера (очередь лимита, сборка схемы) — `#lib/fetch` `readTaskStream`. */
  onTask?: (task: StreamTask) => void
}

export type CharactersPage = {
  items: RickMortyCharacter[]
  page: number
  limit: number
  totalItems: number
  totalPages: number
  hasNext: boolean
  /** Что сервер не применил и почему: молчание запрещено. */
  dropped?: readonly { key: string; reason: string }[]
}

const STATUS_LABELS: Record<string, string> = { Alive: 'жив', Dead: 'мёртв', unknown: 'неизвестно' }
const GENDER_LABELS: Record<string, string> = {
  Female: 'женский',
  Male: 'мужской',
  Genderless: 'бесполый',
  unknown: 'пол неизвестен',
}
export const rickMortyStatusLabel = (status: string): string => STATUS_LABELS[status] ?? status
export const rickMortyGenderLabel = (gender: string): string => GENDER_LABELS[gender] ?? gender

/** Тексты записи для fuzzy-ранжирования: имя, вид, подвид. */
export function rickMortyTexts(item: RickMortyCharacter): string[] {
  return [item.name, item.species, ...(item.type ? [item.type] : [])]
}

/**
 * Страница персонажей из браузера — через наш эндпоинт. Ошибка сервера едет
 * текстом причины (502/504 → ErrorRow пагинатора), а не пустым списком.
 */
export async function getCharactersPage({ api, page, limit, search, filters, signal, onTask }: CharactersQuery): Promise<CharactersPage> {
  if (typeof window === 'undefined') {
    throw new Error('[rickmorty] живой источник запрашивается из браузера; на сервере — мост лоадера')
  }
  const qs = new URLSearchParams({ api, page: String(page), limit: String(limit) })
  if (search) qs.set('search', search)
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (value === undefined || value === null || value === '') continue
    qs.set(key, Array.isArray(value) ? value.join(',') : String(value))
  }
  const res = await fetchWithTask(`/api/rickmorty/characters?${qs}`, { signal, onTask })
  if (!res.ok) throw await responseError(res, 'Персонажи Rick and Morty недоступны')
  return (await res.json()) as CharactersPage
}
