// Лёгкая проверка сигнатуры (magic bytes) первого сегмента файла против заявленного MIME и расширения.
//
// Закрывает расхождение «ожидание на Кадре 0 vs реальность в потоке», когда валидатор
// `v.accept(...)` проверил только строковый паспорт файла, а сырой сокет-клиент пытается
// протолкнуть поддельный формат или активный HTML/SVG/EXE под видом документа/картинки.

function startsWith(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.byteLength < offset + sig.length) return false
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false
  }
  return true
}

function asciiHeadLower(bytes: Uint8Array, maxLen = 256): string {
  const slice = bytes.subarray(0, Math.min(bytes.byteLength, maxLen))
  let s = ''
  for (let i = 0; i < slice.byteLength; i++) {
    const b = slice[i]!
    if (b === 0) break
    s += String.fromCharCode(b)
  }
  return s.trimStart().toLowerCase()
}

function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot).toLowerCase() : ''
}

function looksLikeActiveMarkup(bytes: Uint8Array): boolean {
  const head = asciiHeadLower(bytes, 256)
  return (
    head.startsWith('<!doctype html') ||
    head.startsWith('<html') ||
    head.startsWith('<script') ||
    head.startsWith('<svg') ||
    (head.startsWith('<?xml') && head.includes('<svg'))
  )
}

function looksLikeWindowsExecutable(bytes: Uint8Array): boolean {
  // MZ PE/DOS заголовок
  return startsWith(bytes, [0x4d, 0x5a])
}

/**
 * Проверить первый непустой сегмент файла. Возвращает текст ошибки на русском или `null`, если сигнатура валидна.
 */
export function verifyFirstSegmentSignature(
  declaredType: string,
  filename: string,
  firstChunk: Uint8Array,
): string | null {
  if (firstChunk.byteLength === 0) return null

  const mime = declaredType.split(';')[0]!.trim().toLowerCase()
  const ext = extOf(filename)

  // 1) Строгие бинарные сигнатуры распространённых форматов
  if (mime === 'image/png' || ext === '.png') {
    if (!startsWith(firstChunk, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
      return 'Содержимое файла не является корректным изображением PNG'
    }
    return null
  }

  if (mime === 'image/jpeg' || ext === '.jpg' || ext === '.jpeg') {
    if (!startsWith(firstChunk, [0xff, 0xd8, 0xff])) {
      return 'Содержимое файла не является корректным изображением JPEG'
    }
    return null
  }

  if (mime === 'image/gif' || ext === '.gif') {
    const isGif87 = startsWith(firstChunk, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
    const isGif89 = startsWith(firstChunk, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    if (!isGif87 && !isGif89) {
      return 'Содержимое файла не является корректным изображением GIF'
    }
    return null
  }

  if (mime === 'image/webp' || ext === '.webp') {
    const isRiff = startsWith(firstChunk, [0x52, 0x49, 0x46, 0x46])
    const isWebp = startsWith(firstChunk, [0x57, 0x45, 0x42, 0x50], 8)
    if (!isRiff || !isWebp) {
      return 'Содержимое файла не является корректным изображением WebP'
    }
    return null
  }

  if (mime === 'application/pdf' || ext === '.pdf') {
    if (!startsWith(firstChunk, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
      return 'Содержимое файла не соответствует формату PDF'
    }
    return null
  }

  if (mime === 'application/zip' || mime === 'application/x-zip-compressed' || ext === '.zip') {
    const isPk =
      startsWith(firstChunk, [0x50, 0x4b, 0x03, 0x04]) ||
      startsWith(firstChunk, [0x50, 0x4b, 0x05, 0x06]) ||
      startsWith(firstChunk, [0x50, 0x4b, 0x07, 0x08])
    if (!isPk) {
      return 'Содержимое файла не соответствует формату архива ZIP'
    }
    return null
  }

  if (mime === 'application/gzip' || mime === 'application/x-gzip' || ext === '.gz') {
    if (!startsWith(firstChunk, [0x1f, 0x8b])) {
      return 'Содержимое файла не соответствует формату архива GZIP'
    }
    return null
  }

  // 2) Защита от маскировки активной разметки (HTML/SVG/скрипт) или исполняемого PE под чужой тип
  const explicitlyMarkup =
    mime === 'text/html' ||
    mime === 'application/xhtml+xml' ||
    mime === 'image/svg+xml' ||
    mime === 'text/xml' ||
    mime === 'application/xml' ||
    ext === '.html' ||
    ext === '.htm' ||
    ext === '.svg' ||
    ext === '.xml'

  if (!explicitlyMarkup && mime !== 'application/octet-stream' && looksLikeActiveMarkup(firstChunk)) {
    return 'Обнаружена активная HTML/SVG-разметка, не соответствующая заявленному типу файла'
  }

  const explicitlyExecutable =
    mime === 'application/x-msdownload' ||
    mime === 'application/x-dosexec' ||
    mime === 'application/vnd.microsoft.portable-executable' ||
    mime === 'application/octet-stream' ||
    ext === '.exe' ||
    ext === '.dll' ||
    ext === '.bin'

  if (!explicitlyExecutable && looksLikeWindowsExecutable(firstChunk)) {
    return 'Обнаружен исполняемый файл, не соответствующий заявленному типу'
  }

  return null
}
