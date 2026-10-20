/**
 * Аватарный конвейер — подготовка в браузере на lib/image
 * (browser-image-pipeline): файл → квадрат edge×edge → JPEG ≤ maxBytes →
 * dataURL в скрытое поле формы.
 *
 * Валидация входа — по СОДЕРЖИМОМУ, не по имени/типу файла:
 * `probeImageHeader` разбирает заголовки (формат, размеры) без декодирования;
 * формат сверяется с белым списком конфига, дальше lib/image реально
 * декодирует (переименованный zip не декодируется; EXIF-ориентация —
 * `from-image`) и ПЕРЕКОДИРУЕТ в JPEG — посторонняя начинка структурно не
 * выживает. Квадрат — `frame({fit:'cover'})`: меньшая сторона дотянута до
 * `edge`, большая обрезана по центру (прежняя семантика drawSquare). Вес —
 * предикат `fit`: наивысшее качество из сетки, чей JPEG влезает в
 * `maxBytes` (байты картинки — та же мера, что у серверного `checkAvatar`).
 *
 * Пределы (`edge`, `maxBytes`, форматы) — из конфига модуля: их отдаёт load
 * страницы, здесь они аргументы, не константы. Ядро lib/image грузится
 * лениво (динамический импорт при первом выборе файла) — как раньше
 * грузились compressorjs/mozjpeg чанками.
 */
import { probeImageHeader } from '#lib/image/probe.js'
import type { Decoder } from '#lib/image/index.js'

/** Пределы конвейера (из конфига модуля, прилетают в данных страницы). */
export type AvatarLimits = {
  edge: number
  maxBytes: number
  formats: readonly string[]
}

/** Короткие имена форматов конфига → MIME (probe говорит MIME-типами). */
const MIME_BY_NAME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

/** Итог: строка `data:image/jpeg;base64,…` или причина отказа. */
export type AvatarOutcome =
  | { ok: true; dataUrl: string; bytes: number; quality: number; encoder: 'mozjpeg' }
  | { ok: false; code: 'profile.avatar-format' | 'profile.avatar-size' }

/** Необязательные шлюзы: отмена и декодер (вне браузера — тесты/сервер). */
export type PrepareAvatarOptions = {
  signal?: AbortSignal
  decoder?: Decoder
}

/** Шапка для probe: SOF/IHDR/VP8 обычно в первых килобайтах; мегабайт — с запасом на EXIF. */
const PROBE_HEAD_BYTES = 1_048_576

/** Потолок декодируемого исходника: защита от «бомб» (64 Мп ≈ 256 МБ RGBA). */
const MAX_SOURCE_PIXELS = 64_000_000

/**
 * Полный конвейер: файл → dataURL ≤ maxBytes. Отказ — доменный код, понятный
 * инструкции ошибок (`profile.avatar-format`, `profile.avatar-size`).
 */
export async function prepareAvatar(
  file: File,
  limits: AvatarLimits,
  opts: PrepareAvatarOptions = {},
): Promise<AvatarOutcome> {
  // 1. Формат и размеры — по содержимому (probe), белый список — из конфига.
  const head = new Uint8Array(await file.slice(0, PROBE_HEAD_BYTES).arrayBuffer())
  const facts = probeImageHeader(head)
  const allowed = new Set(limits.formats.map((f) => MIME_BY_NAME[f]).filter(Boolean))
  if (!facts || !allowed.has(facts.format)) return { ok: false, code: 'profile.avatar-format' }
  if (facts.width * facts.height > MAX_SOURCE_PIXELS) return { ok: false, code: 'profile.avatar-size' }

  // 2. Декод → cover-квадрат → fit по весу готового JPEG.
  const { image, EnvironmentError, ResourceLimitError } = await import('#lib/image/index.js')
  let hit
  try {
    hit = await image(
      file,
      async (p) => {
        await p.frame({ width: limits.edge, height: limits.edge, fit: 'cover', method: 'lanczos3' })
        return p.fit(
          { formats: ['image/jpeg'], quality: [0.3, 0.95] },
          (c) => c.size <= limits.maxBytes,
          { deadlineMs: 4_500, onBudgetExhausted: 'return-null' },
        )
      },
      { signal: opts.signal, decoder: opts.decoder, maxPixels: MAX_SOURCE_PIXELS },
    )
  } catch (error) {
    // Отмена и «нет браузера» — не вина файла: пробрасываем как есть.
    if (error instanceof EnvironmentError) throw error
    if (error instanceof Error && error.name === 'AbortError') throw error
    if (error instanceof ResourceLimitError) return { ok: false, code: 'profile.avatar-size' }
    // Декодер/кодек не взяли содержимое — для пользователя это «не картинка».
    return { ok: false, code: 'profile.avatar-format' }
  }
  if (!hit) return { ok: false, code: 'profile.avatar-size' }
  return {
    ok: true,
    dataUrl: await toDataUrl(hit.blob),
    bytes: hit.blob.size,
    quality: hit.params.quality,
    encoder: 'mozjpeg',
  }
}

/** Blob → dataURL без FileReader (btoa чанками; работает и в Node для тестов). */
async function toDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return `data:${blob.type};base64,${btoa(binary)}`
}
