// ПРОВЕРКА ИЗОБРАЖЕНИЙ — общее правило для любого файлового поля.
//
// Проверка смотрит на ОБЕЩАНИЕ клиента и на содержимое: файл, который назвался
// картинкой (`image/*`), обязан ею быть — заголовок байтов решает, а не имя и не
// тип. Отказ — строка на КАЖДЫЙ плохой файл: поле принимает список, и молчать
// про второй испорченный файл, показав только первый, значит врать о форме.
//
// Модуль не знает ни одного конкретного поля: `checks.register('image', …)` в
// `extend.ts` делает правило доступным всем формам приложения — и тем, что
// рисуют аватар, и тем, что принимают любые картинки.
import { check, issue } from '#lib/form/index.js'
import type { AsyncCheck, CheckRegistry, Issue } from '#lib/form/index.js'

/** Что считается изображением: форматы, которые разбирает проба заголовка. */
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const

/** Потолки содержимого: заголовок читается ДО декодирования, бомбу режем здесь. */
export const IMAGE_MAX_PIXELS = 64_000_000
/** Потолок одной стороны по заголовку, px. */
export const IMAGE_MAX_SIDE = 16_384

/** Голова файла для пробы: JPEG с поздним SOF дальше среза не разберётся. */
export const IMAGE_HEAD_BYTES = 256 * 1024

/** Параметры проверки: чем считать картинку и какие потолки применять. */
export interface ImageCheckSpec {
  /** Разрешённые MIME-форматы по заголовку. */
  readonly formats: readonly string[]
  /** Потолок произведения сторон, px². */
  readonly maxPixels: number
  /** Потолок одной стороны, px. */
  readonly maxSide: number
}

/** Умолчания проверки: всё, что умеет проба, и безопасные потолки. */
export const DEFAULT_IMAGE_SPEC: ImageCheckSpec = {
  formats: IMAGE_MIME_TYPES,
  maxPixels: IMAGE_MAX_PIXELS,
  maxSide: IMAGE_MAX_SIDE,
}

const filesOf = (value: unknown): readonly File[] => {
  if (value instanceof File) return [value]
  if (Array.isArray(value)) return value.filter((x): x is File => x instanceof File)
  return []
}

/** Обещание клиента: тип начинается с `image/`. Не обещал — не наше дело. */
const claimsImage = (file: File): boolean => file.type.toLowerCase().startsWith('image/')

/**
 * Проверить один файл: обещал картинку → смотрим заголовок.
 *
 * @param file Файл из значения поля.
 * @param spec Форматы и потолки.
 * @param probe Проба заголовка (`#lib/image/probe`), передаётся снаружи: модуль
 *   не тянет конвейер изображений целиком и не тянет wasm.
 * @returns Ошибка файла или `null`.
 */
async function checkOne(
  file: File,
  spec: ImageCheckSpec,
  probe: (bytes: Uint8Array) => { format: string; width: number; height: number } | null,
): Promise<Issue | null> {
  if (!claimsImage(file)) return null
  const head = new Uint8Array(await file.slice(0, IMAGE_HEAD_BYTES).arrayBuffer())
  const info = probe(head)
  if (!info || !spec.formats.includes(info.format))
    return issue('image.format', { name: file.name, ...(info ? { format: info.format } : {}) })
  if (info.width * info.height > spec.maxPixels || Math.max(info.width, info.height) > spec.maxSide)
    return issue('image.dimensions', {
      name: file.name, width: info.width, height: info.height,
      maxPixels: spec.maxPixels, maxSide: spec.maxSide,
    })
  return null
}

/**
 * Собрать проверку по параметрам. Одним правилом судятся ВСЕ файлы поля:
 * одиночный файл — как список из одного.
 *
 * @param spec Форматы и потолки; по умолчанию `DEFAULT_IMAGE_SPEC`.
 */
export function imageCheck(spec: ImageCheckSpec = DEFAULT_IMAGE_SPEC): AsyncCheck {
  return async (value) => {
    const { probeImageHeader } = await import('#lib/image/probe.js')
    const out: Issue[] = []
    for (const file of filesOf(value)) {
      const bad = await checkOne(file, spec, probeImageHeader)
      if (bad) out.push(bad)
    }
    return out.length ? out : null
  }
}

/**
 * Правило для описания формы: `validate: [v.accept([...]), v.maxSize(n), image()]`.
 * Параметры проверки — у РЕЕСТРА (`registerImageCheck`), а не у поля: правило
 * одно на приложение, иначе поля начнут судить одно и то же по-разному.
 *
 * `cacheByValue: false` обязателен: `File` не ключуется по значению, и кэш
 * ответил бы вердиктом предыдущего файла.
 */
export const image = () => check('image', { cacheByValue: false })

/**
 * Положить проверку в реестр приложения: `checks.register('image', imageCheck())`.
 * Формы ссылаются на неё по имени — правило одно на всё приложение.
 *
 * @param registry Реестр проверок приложения.
 * @param spec Форматы и потолки содержимого.
 */
export function registerImageCheck(registry: CheckRegistry, spec: ImageCheckSpec = DEFAULT_IMAGE_SPEC): void {
  registry.register('image', imageCheck(spec))
}
