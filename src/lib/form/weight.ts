// Вес тела формы: сколько байтов реально уйдёт на провод.
//
// Считается по списку записей ровно так, как их сериализует браузер (черновик
// WHATWG «multipart/form-data», алгоритм сериализации): на каждую часть —
// граница `--boundary` + CRLF, заголовок `Content-Disposition` с именем части,
// для файла ещё `; filename="…"` и `Content-Type`, затем значение и CRLF;
// в конце — `--boundary--`.
//
// Поэтому текст считается БАЙТАМИ, а не символами: `value.length` — единицы
// UTF-16, а кириллица в UTF-8 весит 2 байта на символ, эмодзи — 4. Файлы не
// читаются: у них известен `size`, и это всё, что нужно.
//
// Точность: длина границы задаётся параметром. Браузер выбирает её сам (по
// черновику — от 27 до 70 байт; Chromium и WebKit берут 38), поэтому по
// умолчанию считается ХУДШИЙ случай — 70 байт на каждую границу. Реальная
// длина снимается с готового `FormData` через `boundaryBytesOf` (`Response`
// сообщает заголовок, тело при этом не читается).

/** Минимальная длина границы по черновику WHATWG: 27 байт. */
export const MIN_BOUNDARY_BYTES = 27
/** Максимальная длина границы по черновику WHATWG и RFC 2046: 70 байт. */
export const MAX_BOUNDARY_BYTES = 70

/** Из чего складывается вес тела. */
export interface WeightParts {
  /** Вес значений текстовых частей, байт. */
  readonly text: number
  /** Сумма `size` файлов, байт. */
  readonly files: number
  /** Границы, заголовки частей, CRLF — всё, что не значение, байт. */
  readonly overhead: number
  /** Итого: столько байтов уйдёт в теле запроса. */
  readonly total: number
  /** Длина границы, по которой считали, байт. */
  readonly boundary: number
}

/** Одна запись формы: имя части и значение — строка или файл. */
export type WeightEntry = readonly [name: string, value: string | File]

const encoder = new TextEncoder()
const CRLF = 2
const DISPOSITION = 'Content-Disposition: form-data; name="'
const FILENAME = '"; filename="'
const CONTENT_TYPE = 'Content-Type: '
/** Тип файла без типа — по RFC 7578 уходит именно он. */
const DEFAULT_TYPE = 'application/octet-stream'

const utf8 = (s: string): number => encoder.encode(s).length

/**
 * Одиночные CR и LF → CRLF: сериализация нормализует переводы строк, и на этом
 * можно незаметно ошибиться в весе (каждый одиночный LF добавляет байт).
 */
const normalizeNewlines = (s: string): string => s.replace(/\r(?!\n)|(?<!\r)\n/g, '\r\n')

/**
 * Имя части в заголовке: переводы строк → CRLF, затем байты CR, LF и `"` уходят
 * в `%0D`, `%0A`, `%22` — так их и кодирует браузер.
 */
const escapeName = (s: string): string =>
  normalizeNewlines(s).replace(/[\r\n"]/g, (c) => (c === '\r' ? '%0D' : c === '\n' ? '%0A' : '%22'))

/**
 * Вес `multipart/form-data` тела по списку записей.
 *
 * @param entries Записи в порядке отправки: `[имя, значение]`.
 * @param boundaryBytes Длина границы, байт; по умолчанию худший случай (70).
 * @returns Разбивка по частям и итог.
 */
export function multipartWeight(
  entries: Iterable<WeightEntry>,
  boundaryBytes: number = MAX_BOUNDARY_BYTES,
): WeightParts {
  let text = 0
  let files = 0
  let overhead = 0
  for (const [name, value] of entries) {
    // `--boundary` + CRLF перед частью
    overhead += 2 + boundaryBytes + CRLF
    overhead += utf8(DISPOSITION) + utf8(escapeName(name))
    if (typeof value === 'string') {
      overhead += 1 + CRLF * 2 // закрывающая кавычка, пустая строка заголовков
      text += utf8(normalizeNewlines(value))
      overhead += CRLF // после значения
    } else {
      overhead += utf8(FILENAME) + utf8(escapeName(value.name)) + 1 + CRLF
      overhead += utf8(CONTENT_TYPE) + utf8(value.type || DEFAULT_TYPE) + CRLF * 2
      files += value.size
      overhead += CRLF // после содержимого файла
    }
  }
  // закрывающая граница `--boundary--` (без завершающего CRLF: так её пишут
  // и браузеры, и undici — расхождение в 2 байта несущественно на фоне запаса)
  overhead += 2 + boundaryBytes + 2
  return { text, files, overhead, total: text + files + overhead, boundary: boundaryBytes }
}

/**
 * Вес тела формы по её значениям — без сборки `FormData` и без чтения файлов.
 *
 * Записи получаются тем же `encode` типа значения, что уходит в отправку:
 * значит в вес попадает ровно то, что форма пошлёт.
 *
 * @param d Описание формы.
 * @param values Значения по именам полей (декодированные, как в проверке).
 * @param boundaryBytes Длина границы, байт; по умолчанию худший случай.
 */
export function formWeight(
  d: import('./describe').FormDescription,
  values: Record<string, unknown>,
  boundaryBytes: number = MAX_BOUNDARY_BYTES,
): WeightParts {
  const pairs: Array<[string, string | File]> = []
  for (const f of d.fields) {
    const v = values[f.name]
    if (v === undefined) continue
    d.registry.types.get(f.kind).encode(v, f.name, pairs, { field: f })
  }
  return multipartWeight(pairs, boundaryBytes)
}

/**
 * Длина границы из готового `FormData` — без чтения тела.
 *
 * `Response` сообщает `Content-Type` с границей сразу при создании и тело не
 * разбирает, поэтому снять реальную длину дёшево. Нужна там, где важна точность
 * (перед отправкой), а не оценка сверху.
 *
 * @param fd Записи формы.
 * @returns Длина границы, байт; `undefined` — среду спросить не удалось.
 */
export function boundaryBytesOf(fd: FormData): number | undefined {
  try {
    const header = new Response(fd).headers.get('content-type')
    if (!header) return undefined
    const at = header.indexOf('boundary=')
    if (at < 0) return undefined
    const raw = header.slice(at + 'boundary='.length).trim()
    const value = raw.startsWith('"') ? raw.slice(1, raw.indexOf('"', 1)) : raw.split(';')[0]!.trim()
    return value ? utf8(value) : undefined
  } catch {
    return undefined
  }
}
