// URL-контур формы (этап 4, §6.4): адрес ⇄ значения.
//
// Кодек НЕ знает о носителе: чтение и запись адреса — дело хоста (url-адаптер
// пагинатора, sink). Здесь только два чистых преобразования ПО ТЕМУ ЖЕ типу
// контракту полей (decode/encode реестра), поэтому значения из GET совпадают
// со значениями POST-конверта байт в байт — один код-путь на оба транспорта.
import { decode, type Decoded } from './decode'
import type { FormDescription } from './describe'

/**
 * Адрес (строка запроса) → значения + структурные ошибки разбора.
 * `URLSearchParams` совместим с `EntrySource` — разбор общий с POST.
 */
export function readUrlForm(search: string | URLSearchParams, d: FormDescription): Decoded {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  return decode(params, d)
}

/**
 * Значения → query string.
 * - дефолт и пустое НЕ пишутся: отсутствие ключа и есть дефолт (чистота адреса);
 * - чужие ключи `base` сохраняются как были — параметры страницы форме не принадлежат;
 * - несколько значений — повторяющиеся ключи (нативная семантика GET-форм;
 *   канонический CSV собирает потребитель через lib/links, не кодек);
 * - file-поля в GET невозможны — пропускаются (как браузер при нативной отправке).
 */
export function writeUrlForm(
  values: Record<string, unknown>,
  d: FormDescription,
  base: string | URLSearchParams = '',
): string {
  const params = new URLSearchParams(base)
  const emit: Array<[string, string]> = []
  /** Все ключи, которые форма МОГЛА оставить в адресе (значение + дефолт) — подчистить. */
  const possible = new Set<string>()
  for (const f of d.fields) {
    possible.add(f.name)
    const type = d.registry.types.get(f.kind)
    for (const src of [values[f.name], f.defaultValue]) {
      if (src === undefined) continue
      const out: Array<[string, string | File]> = []
      type.encode(src as never, f.name, out)
      for (const [k] of out) possible.add(k)
    }
    const v = values[f.name]
    if (v === undefined || v === null || v === '' || v === f.defaultValue || v === type.empty) continue
    if (Array.isArray(v) && v.length === 0) continue
    const out: Array<[string, string | File]> = []
    type.encode(v as never, f.name, out)
    for (const [k, val] of out) if (typeof val === 'string') emit.push([k, val])
  }
  for (const k of possible) params.delete(k)
  for (const [k, val] of emit) params.append(k, val)
  return params.toString()
}

/* ─────────────────── URL-контур бинда (S2, §6.4) ─────────────────── */

/** Триггер коммита: живое поле или отправка формы. */
export type UrlCommitVia = 'field' | 'submit'

/**
 * Привязка формы к адресу: форма НЕ знает про адрес — хост даёт ей sink
 * коммита набора (обычно `setExtra` пагинатора: «ключи, чтение значений,
 * коммит — через хранилище») и начальное зеркало значений. До оживления
 * форма — нативный GET (браузер, кнопка), после — живая (поля коммитят,
 * `submitVisible` гасит кнопку).
 */
export interface UrlFormOptions {
  /** Sink хоста: патч объявленных ключей. */
  commit: (patch: Record<string, unknown>, via: UrlCommitVia) => void
  /** Action нативного GET (путь страницы). По умолчанию pathname браузера, на SSR ''. */
  action?: string
  /**
   * Начальное зеркало значений (хост: из состояния хранилища — тот же принцип,
   * что `bf31d56` у поиска). Применяется ОДИН раз при связке, без валидации:
   * серверный рендер обязан показать текущие значения, а не пустые поля.
   */
  seed?: (d: FormDescription) => Record<string, unknown>
  /**
   * Живой коммит по `change` (делегат на форму). По умолчанию включён — панель
   * настроек применяет каждое поле сразу. Формы с «коммит-набором» (фильтры:
   * «Применить» целиком, all-or-nothing) ставят `live: false`: тогда адрес/стор
   * видят только полный набор — submit-путь и явный `commit()` хоста.
   */
  live?: boolean
}
