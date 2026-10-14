/**
 * Схема фильтров персонажей Rick and Morty — ВТОРАЯ реальная схема каталога
 * (F54): та же `paginate/filters`, что у Shikimori, но другой источник, другие
 * типы полей (`text`) и статические значения.
 *
 * Значения здесь полные и неизменные (их объявляет документация API,
 * https://rickandmortyapi.com/documentation/#filter-characters), поэтому схема
 * изоморфна целиком: серверной сборки из справочников, как у Shikimori, ей не
 * нужно. Измерено живьём (2026-10-12): `status` и `gender` совпадают точно
 * (610 + 148 + 19 + 49 = 826 персонажей по полу), `species` и `type` API
 * ищет ПОДСТРОКОЙ (`human` находит и `Humanoid`) — поэтому они текстовые поля,
 * а не выбор: список вариантов обещал бы точное совпадение, которого нет.
 *
 * Обе версии источника (REST и GraphQL) понимают одни и те же параметры
 * фильтра, поэтому схема одна: переключение между ними не меняет ни ключей
 * адреса, ни формы — фильтры и поиск переживают смену транспорта.
 */
import {
  catalogFilterFieldNames,
  filterParams,
  type CatalogFilterField,
  type CatalogFilterFormOptions,
  type CatalogFilterSchema,
} from '#lib/paginate/filters/index.js'
import { defineForm, field, type FormDescription } from '#lib/form/index.js'
import { commaListSearch, type ExtraSearchSpec, type ExtraValue } from '#lib/paginate/index.js'

export const RICKMORTY_FILTER_FIELDS: readonly CatalogFilterField[] = [
  {
    key: 'status',
    label: 'Статус',
    type: 'select',
    options: [
      { value: 'alive', label: 'Жив' },
      { value: 'dead', label: 'Мёртв' },
      { value: 'unknown', label: 'Неизвестно' },
    ],
  },
  {
    key: 'gender',
    label: 'Пол',
    type: 'select',
    options: [
      { value: 'female', label: 'Женский' },
      { value: 'male', label: 'Мужской' },
      { value: 'genderless', label: 'Бесполый' },
      { value: 'unknown', label: 'Неизвестно' },
    ],
  },
  { key: 'species', label: 'Вид (часть слова)', type: 'text' },
  { key: 'type', label: 'Подвид (часть слова)', type: 'text' },
]

export const RICKMORTY_FILTER_SOURCE = 'rickandmorty'

/** Схема целиком: значения статичны, сборка не нужна. */
export const RICKMORTY_FILTER_SCHEMA: CatalogFilterSchema = {
  source: RICKMORTY_FILTER_SOURCE,
  version: 1,
  fields: RICKMORTY_FILTER_FIELDS,
}

/** Ключи extra: `filters.status`, `filters.species`, … — из того же объявления. */
export const RICKMORTY_FILTER_KEYS: readonly string[] = RICKMORTY_FILTER_FIELDS.flatMap(catalogFilterFieldNames)

/**
 * Форма значения в адресе: строка до 120 символов (как у Shikimori). Допустимость
 * значений проверяет схема на сервере — адресный слой отвечает только за форму.
 */
const textValue = commaListSearch((raw: ExtraValue): string | undefined => {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : null
  return text && text.length <= 120 ? text : undefined
})

export const RICKMORTY_FILTER_SEARCH: ExtraSearchSpec = Object.fromEntries(
  RICKMORTY_FILTER_KEYS.map((key) => [key, textValue]),
)

/**
 * Форма фильтров Rick and Morty: поля и подписи — приложения, варианты — из
 * схемы. Вид и подвид API ищет подстрокой, поэтому это текст, а не выбор.
 */
export function rickMortyFilterForm(schema: CatalogFilterSchema, opts?: CatalogFilterFormOptions): FormDescription {
  const filter = filterParams(schema, opts)
  return defineForm({
    id: 'rickmorty-filters',
    policy: filter.policy,
    fields: filter.fields({
      status: field.select({ label: 'Статус', placeholder: 'Любое', ...filter.status }),
      gender: field.select({ label: 'Пол', placeholder: 'Любое', ...filter.gender }),
      species: field.text({ label: 'Вид (часть слова)', ...filter.species }),
      type: field.text({ label: 'Подвид (часть слова)', ...filter.type }),
    }),
  })
}
