/**
 * Приведение картинки к параметрам — возможность ПРИМИТИВА поля файла.
 *
 * Сжатие живёт здесь, а не в `#lib/form`: библиотека форм о картинках не знает.
 * Любой `<FileInput photoConvert={…}>` сжимает выбранное до отправки, гибрид
 * `FileAttachment` передаёт параметры своему `FileInput`, а `Field` только
 * выбирает примитив (`preview` → гибрид). Параметры — обычный объект
 * (`specAvatar` у профиля), поэтому поле не привязано к одному экрану.
 */
import { probeImageHeader } from '#lib/image/probe.js'

/** Параметры приведения: то, что страница передаёт в `Field` опцией `photoConvert`. */
export interface PhotoConvertSpec {
  /** Ширина готового кадра, px. */
  readonly width: number
  /** Высота готового кадра, px. */
  readonly height: number
  /** Предел веса готового файла, байт. */
  readonly maxBytes: number
  /** Конечное расширение (`jpeg` → `image/jpeg`). */
  readonly format: 'jpeg' | 'png' | 'webp'
}

/** Итог: готовый файл либо доменный код отказа. */
export type PhotoConvertOutcome =
  | { ok: true; file: File }
  | { ok: false; code: 'photo.format' | 'photo.size' }

const MIME_BY_FORMAT: Record<PhotoConvertSpec['format'], string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

const PROBE_HEAD_BYTES = 1_048_576
const MAX_SOURCE_PIXELS = 64_000_000

/**
 * Картинка → кадр нужного размера и веса.
 *
 * Квадрат — `frame({ fit: 'cover' })`: меньшая сторона дотянута, большая обрезана
 * по центру. Вес — `fit` по сетке качества: берётся лучшее качество, чей файл
 * влезает в `maxBytes`. Не картинка — `photo.format`; не влезает — `photo.size`.
 *
 * @param file Исходный файл; содержимое смотрится по заголовку, а не по типу.
 * @param spec Размеры, предел веса и конечный формат.
 * @param opts Отмена: размонтированное поле не держит декодер.
 */
export async function convertPhoto(
  file: File,
  spec: PhotoConvertSpec,
  opts: { signal?: AbortSignal } = {},
): Promise<PhotoConvertOutcome> {
  const head = new Uint8Array(await file.slice(0, PROBE_HEAD_BYTES).arrayBuffer())
  const facts = probeImageHeader(head)
  if (!facts || facts.width * facts.height > MAX_SOURCE_PIXELS) return { ok: false, code: 'photo.format' }

  const { image } = await import('#lib/image/index.js')
  const mime = MIME_BY_FORMAT[spec.format]
  let hit
  try {
    hit = await image(
      file,
      async (p) => {
        await p.frame({ width: spec.width, height: spec.height, fit: 'cover', method: 'lanczos3' })
        return p.fit(
          { formats: [mime], quality: [0.3, 0.95] },
          (c) => c.size <= spec.maxBytes,
          { deadlineMs: 4_500, onBudgetExhausted: 'return-null' },
        )
      },
      { ...(opts.signal ? { signal: opts.signal } : {}), maxPixels: MAX_SOURCE_PIXELS },
    )
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return { ok: false, code: 'photo.format' }
  }
  if (!hit) return { ok: false, code: 'photo.size' }

  const dot = spec.format === 'jpeg' ? 'jpg' : spec.format
  return { ok: true, file: new File([hit.blob], `photo.${dot}`, { type: mime }) }
}
