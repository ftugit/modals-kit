/** Минимальная декларация compressorjs (типов в реестре нет). */
declare module 'compressorjs' {
  export default class Compressor {
    constructor(file: Blob | File, options?: {
      quality?: number
      mimeType?: string
      convertSize?: number
      width?: number
      height?: number
      success?: (result: Blob) => void
      error?: (error: Error) => void
    })
    static setDefaults(options: Record<string, unknown>): void
  }
}
