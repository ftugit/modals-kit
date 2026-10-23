// ФОТО-ПОЛЕ: расширение библиотеки кодом приложения, как extend.ts, но
// отдельным модулем. extend.ts импортируют все формы приложения, а фото
// нужно только владельцам фото-полей — вес в бандле платит владелец поля,
// а не каждая форма. Ни один файл в src/lib/form при этом не меняется.

import { check, defaultRegistry, issue } from '#lib/form/index.js'
import type { CheckRegistry, Constraint, FieldType, Issue } from '#lib/form/index.js'

// Открытые ключи: подсказки среды возвращаются расширением интерфейсов.
declare module '#lib/form/index.js' {
  interface FieldValues { photo: File | null }
  interface InputModes { photo: true }
}

/* ── фото: тип поля, спецификация, проверка содержимого ────────────── */

/**
 * Вход фото-поля: какое СЫРЬЁ валидатор вообще принимает. Формат и размеры
 * доказываются заголовком файла (`lib/image` probe), а не именем и не MIME,
 * который прислал клиент: валидатор один на клиенте и на сервере, и сервер
 * обязан видеть то же содержимое.
 */
export interface PhotoInputSpec {
  /** MIME-форматы по заголовку, а не по расширению (`image/jpeg`, …). */
  readonly formats: readonly string[]
  /** Предел веса сырого файла, байт (синхронный `v.maxSize` в описании). */
  readonly maxBytes: number
  /** Потолок пикселей по заголовку — декомпрессионную бомбу режем до декода. */
  readonly maxPixels: number
  /** Потолок одной стороны по заголовку. */
  readonly maxSide: number
}

/** Выход фото-поля: готовый результат клиентской и серверной подготовки. */
export interface PhotoOutputSpec {
  readonly format: 'image/jpeg'
  /** Меньшая сторона сводится к этому размеру, большая режется по центру. */
  readonly edge: number
  /** Предел веса готового файла, байт. */
  readonly maxBytes: number
}

/**
 * Спецификация одного фото-поля. Вход и выход разведены сознательно: сырьё
 * шире и тяжелее результата (сервер принимает до `input.maxBytes` трёх
 * форматов, хранит JPEG до `output.maxBytes`), и одно число/список на обе
 * роли — источник двусмысленности.
 */
export interface PhotoSpec {
  /** Ключ поля-спецификации: имя проверки — `photo:<id>`. */
  readonly id: string
  readonly input: PhotoInputSpec
  readonly output: PhotoOutputSpec
}

/**
 * Свой тип: фото одним файлом. Значение и транспорт — как у встроенного
 * `file` (настоящий `File` в `FormData`, заглушка пустого поля — `null`),
 * отдельный вид — ради своего компонента и своей проверки содержимого:
 * обычный `file` внутрь файла не смотрит, фото обязано.
 */
export const photoType: FieldType<File | null> = {
  kind: 'photo',
  inputs: ['photo'],
  multiple: false,
  empty: null,
  decode: (entries) => {
    const f = entries[0]
    return { ok: true, value: f && typeof f !== 'string' && f.name ? f : null }
  },
  encode: (value, name, out) => { if (value) out.push([name, value]) },
  constraints: {
    required: () => ({ required: true }),
    // подсказка выбора, а не проверка: содержимое смотрит `photo:<id>`
    accept: (c: Constraint) => ({ accept: (c as { types: readonly string[] }).types.join(',') }),
    maxSize: () => ({ skip: 'у предела размера нет нативного атрибута' }),
    opaque: true,
  },
  attrs: () => ({ type: 'file' }),
  degradation: { withoutJs: 'выбор файла', lost: 'подготовка на клиенте, превью' },
}

defaultRegistry.registerType(photoType)

/** Голова файла для probe: JPEG, у которого SOF дальше среза, не разберётся. */
export const PHOTO_HEAD_BYTES = 256 * 1024

/**
 * Проверка содержимого фото по спецификации: читает только голову файла и
 * спрашивает probe (`#lib/image/probe.js` — чистый разбор заголовков без
 * кодеков, потому динамический импорт дёшев и не тянет wasm в бандл форм).
 * Не картинка или формат вне `input.formats` — `image.format`; размеры сверх
 * потолков — `image.dimensions`. Пустое поле не её дело (это `required`).
 */
export async function checkPhotoFile(value: unknown, spec: PhotoSpec): Promise<Issue | null> {
  if (!(value instanceof File)) return null
  const { probeImageHeader } = await import('#lib/image/probe.js')
  const head = new Uint8Array(await value.slice(0, PHOTO_HEAD_BYTES).arrayBuffer())
  const info = probeImageHeader(head)
  if (!info || !spec.input.formats.includes(info.format))
    return issue('image.format', { name: value.name, ...(info ? { format: info.format } : {}) })
  if (
    info.width * info.height > spec.input.maxPixels ||
    Math.max(info.width, info.height) > spec.input.maxSide
  )
    return issue('image.dimensions', {
      width: info.width, height: info.height,
      maxPixels: spec.input.maxPixels, maxSide: spec.input.maxSide,
    })
  return null
}

/**
 * Зарегистрировать проверки фото по спецификациям в реестре приложения:
 * одна проверка `photo:<id>` на спецификацию. Реестр строит владелец формы
 * от своего снимка конфига — и отдаёт тот же в `bind` и в обработчик.
 */
export function registerPhotoChecks(registry: CheckRegistry, specs: readonly PhotoSpec[]): void {
  for (const spec of specs)
    registry.register(`photo:${spec.id}`, (value) => checkPhotoFile(value, spec))
}

/**
 * Валидатор-обёртка проверки фото для описания поля. `cacheByValue: false`
 * обязателен: `File` не ключуется по значению, и кэш отвечал бы вердиктом
 * предыдущего файла.
 */
export const photoImage = (specId: string) => check(`photo:${specId}`, { cacheByValue: false })

