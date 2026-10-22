/**
 * Аватарный конвейер — подготовка в браузере и на сервере на `#lib/image`:
 * входной `File` → квадрат `edge×edge` → JPEG `≤ maxBytes` → готовый `File`
 * (`avatar.jpg`) для отправки через форму и `dataURL` для внутреннего хранения.
 *
 * Валидация входа — по СОДЕРЖИМОМУ, не по имени/типу файла:
 * `probeImageHeader` разбирает заголовки (формат, размеры) без декодирования;
 * формат сверяется с белым списком, дальше `#lib/image` реально декодирует
 * (переименованный zip не декодируется; EXIF-ориентация — `from-image`) и
 * ПЕРЕКОДИРУЕТ в JPEG — посторонняя начинка структурно не выживает. Квадрат —
 * `frame({fit:'cover'})`: меньшая сторона дотянута до `edge`, большая обрезана
 * по центру. Вес — предикат `fit`: наивысшее качество из сетки, чей JPEG
 * влезает в `maxBytes`.
 */
import { probeImageHeader } from '#lib/image/probe.js'
import type { Decoder } from '#lib/image/index.js'

/** Пределы конвейера (из конфига модуля, прилетают в данных страницы). */
export type AvatarLimits = {
  edge: number
  maxBytes: number
  formats: readonly string[]
  nicknameForbidden?: readonly string[]
}

/** Короткие имена форматов конфига → MIME (probe говорит MIME-типами). */
const MIME_BY_NAME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

/** Итог: готовый JPEG-файл `avatar.jpg` + `dataURL` или причина отказа. */
export type AvatarOutcome =
  | { ok: true; file: File; dataUrl: string; bytes: number; quality: number; encoder: 'mozjpeg' }
  | { ok: false; code: 'profile.avatar-format' | 'profile.avatar-size' }

/** Необязательные шлюзы: отмена и декодер (вне браузера — тесты/сервер). */
export type PrepareAvatarOptions = {
  signal?: AbortSignal
  decoder?: Decoder
}

const PROBE_HEAD_BYTES = 1_048_576
const MAX_SOURCE_PIXELS = 64_000_000

/**
 * Полный конвейер: `File` → готовый JPEG `File` (`≤ maxBytes`) + `dataURL`.
 * Отказ — доменный код, понятный инструкции ошибок (`profile.avatar-format`,
 * `profile.avatar-size`).
 */
export async function prepareAvatar(
  file: File,
  limits: AvatarLimits,
  opts: PrepareAvatarOptions = {},
): Promise<AvatarOutcome> {
  const head = new Uint8Array(await file.slice(0, PROBE_HEAD_BYTES).arrayBuffer())
  const facts = probeImageHeader(head)
  const allowed = new Set(limits.formats.map((f) => MIME_BY_NAME[f]).filter(Boolean))
  if (!facts || !allowed.has(facts.format)) return { ok: false, code: 'profile.avatar-format' }
  if (facts.width * facts.height > MAX_SOURCE_PIXELS) return { ok: false, code: 'profile.avatar-size' }

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
    if (error instanceof EnvironmentError) throw error
    if (error instanceof Error && error.name === 'AbortError') throw error
    if (error instanceof ResourceLimitError) return { ok: false, code: 'profile.avatar-size' }
    return { ok: false, code: 'profile.avatar-format' }
  }
  if (!hit) return { ok: false, code: 'profile.avatar-size' }
  const preparedFile = new File([hit.blob], 'avatar.jpg', { type: 'image/jpeg' })
  return {
    ok: true,
    file: preparedFile,
    dataUrl: await toDataUrl(hit.blob),
    bytes: hit.blob.size,
    quality: hit.params.quality,
    encoder: 'mozjpeg',
  }
}

async function toDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return `data:${blob.type};base64,${btoa(binary)}`
}
