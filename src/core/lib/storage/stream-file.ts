import type { LazyContent } from '@remix-run/lazy-file'

/**
 * Потоковый `File` без буферизации содержимого в памяти (`0` байт в `super([])`).
 *
 * В отличие от `LazyFile` из `@remix-run/lazy-file` (`implements Blob` без наследования),
 * `StreamFile` наследует нативный `File`: проходит `instanceof File`, `instanceof Blob`,
 * `FormData.append(name, file)` и побайтовые срезы `file.slice(start, end)` (например
 * проверку заголовка изображения в первых `256 КБ`), подтягивая только запрошенный диапазон.
 */
export class StreamFile extends File {
  readonly #content: LazyContent
  readonly #start: number
  readonly #end: number

  constructor(
    content: LazyContent,
    name: string,
    options: FilePropertyBag = {},
    start = 0,
    end = content.byteLength,
  ) {
    super([], name, options)
    this.#content = content
    this.#start = Math.max(0, Math.min(start, content.byteLength))
    this.#end = Math.max(this.#start, Math.min(end, content.byteLength))
  }

  /** Размер диапазона в байтах без чтения потока. */
  override get size(): number {
    return this.#end - this.#start
  }

  /** Поток байтов для текущего диапазона `[start, end)`. */
  override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
    return this.#content.stream(this.#start, this.#end)
  }

  /** Ленивый срез файла без чтения данных в память. */
  override slice(start = 0, end = this.size, contentType = this.type): StreamFile {
    const total = this.size
    const relStart = start < 0 ? Math.max(total + start, 0) : Math.min(start, total)
    const relEnd = end < 0 ? Math.max(total + end, 0) : Math.min(end, total)
    const clampedEnd = Math.max(relStart, relEnd)
    return new StreamFile(
      this.#content,
      this.name,
      { type: contentType, lastModified: this.lastModified },
      this.#start + relStart,
      this.#start + clampedEnd,
    )
  }

  /** Вычитать диапазон в `Uint8Array` (используется точечно на малых срезах). */
  override async bytes(): Promise<Uint8Array<ArrayBuffer>> {
    const chunks: Uint8Array[] = []
    let total = 0
    const reader = this.stream().getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        total += value.byteLength
      }
    } finally {
      reader.releaseLock()
    }
    const merged = new Uint8Array(new ArrayBuffer(total))
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    return merged
  }

  /** Вычитать диапазон в `ArrayBuffer`. */
  override async arrayBuffer(): Promise<ArrayBuffer> {
    const bytes = await this.bytes()
    return bytes.buffer
  }

  /** Вычитать диапазон как UTF-8 строку. */
  override async text(): Promise<string> {
    return new TextDecoder().decode(await this.bytes())
  }
}
