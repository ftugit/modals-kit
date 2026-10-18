/**
 * Аватарный конвейер — ТОЛЬКО браузер (canvas, createImageBitmap).
 *
 * Защита от «не картинки»: magic bytes по белому списку (опция конфига) →
 * реальное декодирование `createImageBitmap` (переименованный zip не декодируется;
 * ориентация EXIF — `from-image`) → перекодировка в JPEG (посторонняя начинка
 * структурно не выживает). Дальше — размер: меньшая сторона дотягивается до
 * `edge` (растяжение, если исходник меньше), большая режется по центру до
 * `edge` → квадрат edge×edge → бинарный поиск качества (7 проб, берём
 * наивысшее качество, что влезает в `maxBytes`; приём browser-image-compression
 * и gkzlabs/image-compression). Энкодер: базово compressorjs (нативный canvas,
 * ~12 КиБ gzip); «экзотика» mozjpeg (@jsquash/jpeg, WASM) — ленивый импорт
 * отдельным чанком, грузится только при первом использовании.
 *
 * Пределы (`edge`, `maxBytes`, форматы) — из конфига модуля: их отдаёт load
 * страницы, здесь они аргументы, не константы.
 */

/** Пределы конвейера (из конфига модуля, прилетают в данных страницы). */
export type AvatarLimits = {
  edge: number
  maxBytes: number
  formats: readonly string[]
}

/** Magic bytes: формат → первые байты файла. */
const MAGIC: Record<string, readonly number[]> = {
  jpeg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  webp: [0x52, 0x49, 0x46, 0x46],
}

/** Итог: строка `data:image/jpeg;base64,…` или причина отказа. */
export type AvatarOutcome =
  | { ok: true; dataUrl: string; bytes: number; quality: number; encoder: 'canvas' | 'mozjpeg' }
  | { ok: false; code: 'profile.avatar-format' | 'profile.avatar-size' }

type Encoder = (bitmap: ImageBitmap, quality: number) => Promise<Blob>

/** Canvas-энкодер (компрессор): рендер bitmap → JPEG через compressorjs. */
async function canvasEncode(bitmap: ImageBitmap, quality: number, edge: number): Promise<Blob> {
  const { default: Compressor } = await import('compressorjs')
  const canvas = document.createElement('canvas')
  canvas.width = edge
  canvas.height = edge
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  drawSquare(bitmap, edge, ctx)
  const source = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob пуст'))), 'image/png'),
  )
  return new Promise<Blob>((resolve, reject) => {
    new Compressor(source, {
      quality,
      mimeType: 'image/jpeg',
      convertSize: 0, // jpeg всегда: конвертация не по порогу размера
      success: resolve,
      error: reject,
    })
  })
}

/** Mozjpeg-энкодер (WASM, ленивый чанк): тот же кадр, энкодер Squoosh. */
async function mozjpegEncode(bitmap: ImageBitmap, quality: number, edge: number): Promise<Blob> {
  const jpeg = await import('@jsquash/jpeg/encode.js')
  await jpeg.init()
  const canvas = document.createElement('canvas')
  canvas.width = edge
  canvas.height = edge
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  drawSquare(bitmap, edge, ctx)
  const data = ctx.getImageData(0, 0, edge, edge)
  const buffer = (await jpeg.default(data, { quality: Math.round(quality * 100) })) as ArrayBuffer
  return new Blob([buffer], { type: 'image/jpeg' })
}

/** Квадрат edge×edge: меньшая сторона дотянута, большая обрезана по центру. */
export function drawSquare(bitmap: ImageBitmap, edge: number, ctx: CanvasRenderingContext2D): void {
  const scale = Math.max(edge / bitmap.width, edge / bitmap.height)
  const w = bitmap.width * scale
  const h = bitmap.height * scale
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, (edge - w) / 2, (edge - h) / 2, w, h)
}

/**
 * Полный конвейер: файл → dataURL ≤ maxBytes. Отказ — доменный код, понятный
 * инструкции ошибок (`profile.avatar-format`, `profile.avatar-size`).
 */
export async function prepareAvatar(file: File, limits: AvatarLimits, useMozjpeg = false): Promise<AvatarOutcome> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const allowed = limits.formats.filter((f) => MAGIC[f] !== undefined)
  const magicOk = allowed.some((f) => {
    const sig = MAGIC[f]
    return sig.every((byte, i) => head[i] === byte)
  })
  if (!magicOk) return { ok: false, code: 'profile.avatar-format' }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return { ok: false, code: 'profile.avatar-format' }
  }
  try {
    const encode: Encoder = useMozjpeg
      ? (b, q) => mozjpegEncode(b, q, limits.edge)
      : (b, q) => canvasEncode(b, q, limits.edge)
    // малый кадр может влезть даже на максимальном качестве — пробуем сверху
    const probe = await encode(bitmap, 0.95)
    if (probe.size <= limits.maxBytes) {
      return { ok: true, dataUrl: await toDataUrl(probe), bytes: probe.size, quality: 0.95, encoder: useMozjpeg ? 'mozjpeg' : 'canvas' }
    }
    let lo = 0.3
    let hi = 0.94
    let best: Blob | undefined
    for (let i = 0; i < 7; i += 1) {
      const mid = (lo + hi) / 2
      const blob = await encode(bitmap, mid)
      if (blob.size <= limits.maxBytes) {
        best = blob
        lo = mid
      } else {
        hi = mid
      }
    }
    if (!best) return { ok: false, code: 'profile.avatar-size' }
    return {
      ok: true,
      dataUrl: await toDataUrl(best),
      bytes: best.size,
      quality: lo,
      encoder: useMozjpeg ? 'mozjpeg' : 'canvas',
    }
  } finally {
    bitmap.close()
  }
}

async function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('чтение блоба не удалось'))
    reader.readAsDataURL(blob)
  })
}
