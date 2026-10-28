// Потоковый драйвер S3-совместимых облаков (Backblaze B2, Cloudflare R2, AWS S3, MinIO)
// на чистом Web Crypto SigV4 (`aws4fetch`), без привязки к Node SDK или фреймворкам.
//
// Потоковая архитектура:
// - при известном `size <= multipartThresholdBytes` отправляет `ReadableStream` напрямую
//   одним подписанным `PUT` (`x-amz-content-sha256: UNSIGNED-PAYLOAD`, `duplex: 'half'`, `0` буферизации в RAM);
// - при `size === undefined` или `size > multipartThresholdBytes` выполняет честный
//   S3 Multipart Upload (`CreateMultipartUpload` -> `UploadPart` по `partSizeBytes` >= 5 МиБ ->
//   `CompleteMultipartUpload`) с гарантированным `AbortMultipartUpload` при ошибке или `AbortSignal`;
// - `lazy(path)` читает диапазоны через подписанный `GET` с `Range: bytes=start-end` (`206 Partial Content`),
//   позволяя перекачивать гигабайтные потоки напрямую между двумя S3-хостами (`B2 <-> R2`) в `O(1)` памяти.
import { AwsClient } from 'aws4fetch'
import { normalizeStoragePath } from './index.js'
import { basenameOfStoragePath } from './memory.js'
import { StreamFile } from './stream-file.js'
import type { DriverPutInput, DriverStoredMeta, StorageDriver } from './types.js'

/** Минимальный размер одной части S3 Multipart Upload по стандарту S3/B2/R2 (`5 МиБ`). */
export const S3_MIN_PART_BYTES = 5 * 1024 * 1024

/** Порог перехода с одиночного потокового `PUT` на S3 Multipart Upload по умолчанию (`64 МиБ`). */
export const DEFAULT_S3_MULTIPART_THRESHOLD_BYTES = 64 * 1024 * 1024

export interface S3DriverOptions {
  /** S3 endpoint хоста (например `https://s3.us-east-005.backblazeb2.com` или `https://<acc>.r2.cloudflarestorage.com`). */
  readonly endpoint: string
  /** Имя бакета. */
  readonly bucket: string
  /** Регион S3 (`us-east-005`, `auto` для Cloudflare R2, `us-east-1` и т.п.). */
  readonly region?: string
  /** Access Key ID. */
  readonly accessKeyId: string
  /** Secret Access Key. */
  readonly secretAccessKey: string
  /** Необязательный изолирующий префикс ключей внутри бакета (например `uploads` или `app-files`). */
  readonly basePath?: string
  /** Базовый публичный URL раздачи. */
  readonly publicBaseUrl?: string
  /** Порог байт, выше которого `put` переключается на Multipart Upload (по умолчанию `64 МиБ`). */
  readonly multipartThresholdBytes?: number
  /** Размер одного парта в Multipart Upload (не менее `5 МиБ`, по умолчанию `5 МиБ`). */
  readonly partSizeBytes?: number
  /** Кастомный `fetch` (для детерминированных контрактных тестов без внешней сети). */
  readonly fetchImpl?: typeof fetch
}

export type S3DriverInput = string | URL | S3DriverOptions

function inferS3RegionFromHost(hostname: string): string {
  const host = hostname.toLowerCase()
  if (host.endsWith('.r2.cloudflarestorage.com')) return 'auto'
  const m = /^s3[.-]([a-z0-9-]+)\.(?:backblazeb2|amazonaws)\.com$/i.exec(host)
  if (m?.[1]) return m[1].toLowerCase()
  return 'auto'
}

/**
 * Разобрать единую DSN-ссылку S3-совместимого хранилища (по аналогии с `DATABASE_URL`):
 * `s3://<accessKeyId>:<urlEncodedSecretKey>@<host[:port]>/<bucket>[/<basePath>][?region=auto]`
 * (или `s3+http://...` для локальных HTTP-стендов).
 */
export function parseS3Url(
  raw: string | URL,
  overrides?: Partial<Omit<S3DriverOptions, 'endpoint' | 'bucket' | 'accessKeyId' | 'secretAccessKey'>>,
): S3DriverOptions {
  let u: URL
  try {
    u = raw instanceof URL ? new URL(raw.toString()) : new URL(String(raw).trim())
  } catch {
    throw new TypeError('[storage/s3] некорректный формат DSN-ссылки S3 (ожидался s3://key:secret@host/bucket)')
  }

  const proto = u.protocol.toLowerCase()
  if (proto !== 's3:' && proto !== 's3s:' && proto !== 's3+http:' && proto !== 's3+https:') {
    throw new TypeError(
      `[storage/s3] неподдерживаемая схема «${u.protocol}» (ожидалась s3:// или s3+http://)`,
    )
  }

  const accessKeyId = decodeURIComponent(u.username || '')
  const secretAccessKey = decodeURIComponent(u.password || '')
  if (!accessKeyId || !secretAccessKey) {
    throw new TypeError('[storage/s3] в ссылке s3:// отсутствуют ключи доступа (key:secret@host)')
  }
  if (!u.host) {
    throw new TypeError('[storage/s3] в ссылке s3:// отсутствует хост endpoint')
  }

  const pathSegments = u.pathname
    .split('/')
    .filter(Boolean)
    .map((seg) => decodeURIComponent(seg))
  const bucket = pathSegments[0] ?? ''
  if (!bucket) {
    throw new TypeError('[storage/s3] в ссылке s3:// не указано имя бакета (/bucket)')
  }
  const restPrefix = pathSegments.slice(1).join('/')
  const basePath = overrides?.basePath ?? (restPrefix ? normalizeStoragePath(restPrefix) : undefined)

  const httpScheme = proto === 's3+http:' ? 'http' : 'https'
  const endpoint = `${httpScheme}://${u.host}`
  const region =
    overrides?.region ??
    u.searchParams.get('region')?.trim() ??
    inferS3RegionFromHost(u.hostname)
  const publicBaseUrl =
    overrides?.publicBaseUrl ?? (u.searchParams.get('publicBaseUrl')?.trim() || undefined)

  return {
    endpoint,
    bucket,
    region: region || 'auto',
    accessKeyId,
    secretAccessKey,
    ...(basePath ? { basePath } : {}),
    ...(publicBaseUrl ? { publicBaseUrl } : {}),
    ...(overrides?.multipartThresholdBytes !== undefined
      ? { multipartThresholdBytes: overrides.multipartThresholdBytes }
      : {}),
    ...(overrides?.partSizeBytes !== undefined ? { partSizeBytes: overrides.partSizeBytes } : {}),
    ...(overrides?.fetchImpl ? { fetchImpl: overrides.fetchImpl } : {}),
  }
}

/**
 * Собрать единую DSN-строку `s3://...` из параметров S3-сервера (с безопасным URL-кодированием ключей).
 */
export function formatS3Url(options: Pick<
  S3DriverOptions,
  'endpoint' | 'bucket' | 'accessKeyId' | 'secretAccessKey' | 'region' | 'basePath'
>): string {
  const endpointUrl = new URL(options.endpoint)
  const scheme = endpointUrl.protocol === 'http:' ? 's3+http' : 's3'
  const user = encodeURIComponent(options.accessKeyId)
  const pass = encodeURIComponent(options.secretAccessKey)
  const cleanPrefix = options.basePath ? `/${encodeS3KeyPath(normalizeStoragePath(options.basePath))}` : ''
  const inferred = inferS3RegionFromHost(endpointUrl.hostname)
  const qs =
    options.region && options.region !== inferred
      ? `?region=${encodeURIComponent(options.region)}`
      : ''
  return `${scheme}://${user}:${pass}@${endpointUrl.host}/${encodeURIComponent(options.bucket)}${cleanPrefix}${qs}`
}

/**
 * Безопасная витрина ссылки `s3://***@host/bucket[/prefix]` без секретов (для логов и UI куки-сейфа).
 */
export function maskS3Url(raw: string | URL): string {
  const parsed = parseS3Url(raw)
  const endpointUrl = new URL(parsed.endpoint)
  const scheme = endpointUrl.protocol === 'http:' ? 's3+http' : 's3'
  const suffix = parsed.basePath ? `/${parsed.basePath}` : ''
  return `${scheme}://***@${endpointUrl.host}/${parsed.bucket}${suffix}`
}

function encodeS3KeyPath(key: string): string {
  return key
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

function xmlEscape(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function extractXmlTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<]+)</${tag}>`)
  const m = re.exec(xml)
  return m ? m[1]!.trim() : null
}

/**
 * Построить потоковый драйвер S3-совместимого хранилища (`kind: 's3'`)
 * из объекта конфигурации или из одной DSN-строки `s3://key:secret@host/bucket[/prefix]`.
 */
export function s3Driver(
  input: S3DriverInput,
  urlOverrides?: Partial<Omit<S3DriverOptions, 'endpoint' | 'bucket' | 'accessKeyId' | 'secretAccessKey'>>,
): StorageDriver {
  const options =
    typeof input === 'string' || input instanceof URL
      ? parseS3Url(input, urlOverrides)
      : input

  if (!options?.endpoint || !options?.bucket || !options?.accessKeyId || !options?.secretAccessKey) {
    throw new TypeError(
      '[storage/s3] s3Driver: обязательны endpoint, bucket, accessKeyId и secretAccessKey',
    )
  }

  const endpointBase = options.endpoint.replace(/\/+$/, '')
  const bucketEncoded = encodeURIComponent(options.bucket)
  const cleanPrefix = options.basePath ? normalizeStoragePath(options.basePath) : ''
  const multipartThreshold =
    options.multipartThresholdBytes ?? DEFAULT_S3_MULTIPART_THRESHOLD_BYTES
  const partSize = Math.max(S3_MIN_PART_BYTES, options.partSizeBytes ?? S3_MIN_PART_BYTES)
  const runtimeFetch = options.fetchImpl ?? fetch

  const aws = new AwsClient({
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    service: 's3',
    region: options.region ?? 'auto',
  })

  function objectKeyOf(normalizedPath: string): string {
    return cleanPrefix ? `${cleanPrefix}/${normalizedPath}` : normalizedPath
  }

  function objectUrlOf(normalizedPath: string, query = ''): string {
    const fullKey = objectKeyOf(normalizedPath)
    const suffix = query ? `?${query}` : ''
    return `${endpointBase}/${bucketEncoded}/${encodeS3KeyPath(fullKey)}${suffix}`
  }

  async function signedFetch(
    url: string,
    init: RequestInit & { duplex?: 'half' },
  ): Promise<Response> {
    const headers = new Headers(init.headers)
    if (!headers.has('x-amz-content-sha256')) {
      headers.set('x-amz-content-sha256', 'UNSIGNED-PAYLOAD')
    }
    // Подписываем только метод, URL и заголовки (без буферизации тела в aws4fetch!)
    const signed = await aws.sign(url, {
      method: init.method ?? 'GET',
      headers,
    })
    return runtimeFetch(signed.url, {
      method: signed.method,
      headers: signed.headers,
      body: init.body,
      signal: init.signal,
      ...(init.duplex ? { duplex: init.duplex } : {}),
    } as RequestInit)
  }

  async function putSingleStream(
    cleanPath: string,
    input: DriverPutInput,
    exactSize: number,
  ): Promise<DriverStoredMeta> {
    const url = objectUrlOf(cleanPath)

    if (exactSize === 0) {
      // S3/R2 для 0 байт принимают пустое тело без chunked ReadableStream
      const reader = input.stream.getReader()
      try {
        const { done, value } = await reader.read()
        if (!done && value && value.byteLength > 0) {
          throw new RangeError(`[storage/s3] поток превысил заявленный размер: ${value.byteLength} > 0`)
        }
      } finally {
        reader.releaseLock()
      }
      const res = await signedFetch(url, {
        method: 'PUT',
        headers: {
          'content-type': input.contentType,
          'content-length': '0',
          'x-amz-meta-mtime': String(input.lastModified),
        },
        body: new Uint8Array(0),
        signal: input.signal,
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`[storage/s3] PUT 0B failed (${res.status}): ${detail.slice(0, 240)}`)
      }
      return {
        path: cleanPath,
        size: 0,
        contentType: input.contentType,
        lastModified: input.lastModified,
      }
    }

    let seen = 0
    const reader = input.stream.getReader()
    const countedStream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        input.signal?.throwIfAborted()
        const { done, value } = await reader.read()
        if (done) {
          if (seen !== exactSize) {
            controller.error(
              new RangeError(
                `[storage/s3] поток оборвался раньше заявленного размера: ${seen} !== ${exactSize}`,
              ),
            )
            return
          }
          controller.close()
          return
        }
        seen += value.byteLength
        if (seen > exactSize) {
          controller.error(
            new RangeError(
              `[storage/s3] поток превысил заявленный размер: ${seen} > ${exactSize}`,
            ),
          )
          return
        }
        controller.enqueue(value)
      },
      cancel(reason) {
        return reader.cancel(reason)
      },
    })

    try {
      const res = await signedFetch(url, {
        method: 'PUT',
        headers: {
          'content-type': input.contentType,
          'content-length': String(exactSize),
          'x-amz-meta-mtime': String(input.lastModified),
        },
        body: countedStream,
        duplex: 'half',
        signal: input.signal,
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`[storage/s3] PUT failed (${res.status}): ${detail.slice(0, 240)}`)
      }
      await res.body?.cancel().catch(() => undefined)
      if (seen !== exactSize) {
        await signedFetch(url, { method: 'DELETE' }).catch(() => undefined)
        throw new RangeError(
          `[storage/s3] поток оборвался раньше заявленного размера: ${seen} !== ${exactSize}`,
        )
      }
      return {
        path: cleanPath,
        size: seen,
        contentType: input.contentType,
        lastModified: input.lastModified,
      }
    } catch (err) {
      await reader.cancel(err).catch(() => undefined)
      throw err
    } finally {
      reader.releaseLock()
    }
  }

  async function putMultipartStream(
    cleanPath: string,
    input: DriverPutInput,
  ): Promise<DriverStoredMeta> {
    input.signal?.throwIfAborted()
    const initRes = await signedFetch(objectUrlOf(cleanPath, 'uploads'), {
      method: 'POST',
      headers: {
        'content-type': input.contentType,
        'x-amz-meta-mtime': String(input.lastModified),
      },
      signal: input.signal,
    })
    if (!initRes.ok) {
      const detail = await initRes.text().catch(() => '')
      throw new Error(
        `[storage/s3] CreateMultipartUpload failed (${initRes.status}): ${detail.slice(0, 240)}`,
      )
    }
    const initXml = await initRes.text()
    const uploadId = extractXmlTag(initXml, 'UploadId')
    if (!uploadId) {
      throw new Error('[storage/s3] CreateMultipartUpload не вернул UploadId')
    }

    const completedParts: Array<{ partNumber: number; etag: string }> = []
    const reader = input.stream.getReader()
    const partBuf = new Uint8Array(partSize)
    let buffered = 0
    let totalSeen = 0
    let partNumber = 1
    let completed = false

    const flushPart = async (slice: Uint8Array<ArrayBuffer>): Promise<void> => {
      const partQuery = `partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`
      const partRes = await signedFetch(objectUrlOf(cleanPath, partQuery), {
        method: 'PUT',
        headers: {
          'content-length': String(slice.byteLength),
        },
        body: slice,
        signal: input.signal,
      })
      if (!partRes.ok) {
        const detail = await partRes.text().catch(() => '')
        throw new Error(
          `[storage/s3] UploadPart #${partNumber} failed (${partRes.status}): ${detail.slice(0, 240)}`,
        )
      }
      const etag = partRes.headers.get('etag')
      await partRes.body?.cancel().catch(() => undefined)
      if (!etag) {
        throw new Error(`[storage/s3] UploadPart #${partNumber} не вернул ETag`)
      }
      completedParts.push({ partNumber, etag })
      partNumber += 1
    }

    try {
      for (;;) {
        input.signal?.throwIfAborted()
        const { done, value } = await reader.read()
        if (done) break
        if (value.byteLength === 0) continue

        totalSeen += value.byteLength
        if (input.size !== undefined && totalSeen > input.size) {
          throw new RangeError(
            `[storage/s3] поток превысил заявленный размер: ${totalSeen} > ${input.size}`,
          )
        }

        let offset = 0
        while (offset < value.byteLength) {
          const take = Math.min(partSize - buffered, value.byteLength - offset)
          partBuf.set(value.subarray(offset, offset + take), buffered)
          buffered += take
          offset += take

          if (buffered === partSize) {
            const copy = new Uint8Array(new ArrayBuffer(partSize))
            copy.set(partBuf)
            buffered = 0
            await flushPart(copy)
          }
        }
      }

      input.signal?.throwIfAborted()
      if (input.size !== undefined && totalSeen !== input.size) {
        throw new RangeError(
          `[storage/s3] поток оборвался раньше заявленного размера: ${totalSeen} !== ${input.size}`,
        )
      }

      if (buffered > 0 || completedParts.length === 0) {
        const tail = new Uint8Array(new ArrayBuffer(buffered))
        tail.set(partBuf.subarray(0, buffered))
        buffered = 0
        await flushPart(tail)
      }

      const completeXml = [
        '<CompleteMultipartUpload>',
        ...completedParts.map(
          (p) =>
            `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${xmlEscape(p.etag)}</ETag></Part>`,
        ),
        '</CompleteMultipartUpload>',
      ].join('')
      const xmlBytes = new TextEncoder().encode(completeXml)

      const completeRes = await signedFetch(
        objectUrlOf(cleanPath, `uploadId=${encodeURIComponent(uploadId)}`),
        {
          method: 'POST',
          headers: {
            'content-type': 'application/xml',
            'content-length': String(xmlBytes.byteLength),
          },
          body: xmlBytes,
          signal: input.signal,
        },
      )
      const completeBody = await completeRes.text()
      if (!completeRes.ok || completeBody.includes('<Error>')) {
        throw new Error(
          `[storage/s3] CompleteMultipartUpload failed (${completeRes.status}): ${completeBody.slice(0, 240)}`,
        )
      }
      completed = true

      return {
        path: cleanPath,
        size: totalSeen,
        contentType: input.contentType,
        lastModified: input.lastModified,
      }
    } finally {
      reader.releaseLock()
      if (!completed) {
        await signedFetch(
          objectUrlOf(cleanPath, `uploadId=${encodeURIComponent(uploadId)}`),
          { method: 'DELETE' },
        ).catch(() => undefined)
      }
    }
  }

  return {
    kind: 's3',
    ...(options.publicBaseUrl !== undefined ? { publicBaseUrl: options.publicBaseUrl } : {}),

    async put(input: DriverPutInput): Promise<DriverStoredMeta> {
      const cleanPath = normalizeStoragePath(input.path)
      input.signal?.throwIfAborted()
      if (input.size !== undefined && input.size <= multipartThreshold) {
        return putSingleStream(cleanPath, input, input.size)
      }
      return putMultipartStream(cleanPath, input)
    },

    async head(path: string): Promise<DriverStoredMeta | null> {
      const cleanPath = normalizeStoragePath(path)
      const res = await signedFetch(objectUrlOf(cleanPath), { method: 'HEAD' })
      await res.body?.cancel().catch(() => undefined)
      if (res.status === 404) return null
      if (!res.ok) {
        throw new Error(`[storage/s3] HEAD failed (${res.status}) for «${cleanPath}»`)
      }

      const rawSize = Number(res.headers.get('content-length') ?? '0')
      const contentType =
        res.headers.get('content-type')?.trim() || 'application/octet-stream'
      const customMtime = Number(res.headers.get('x-amz-meta-mtime') ?? '')
      const parsedHttpDate = Date.parse(res.headers.get('last-modified') ?? '')
      const lastModified = Number.isFinite(customMtime) && customMtime > 0
        ? customMtime
        : Number.isFinite(parsedHttpDate)
          ? parsedHttpDate
          : Date.now()

      return {
        path: cleanPath,
        size: Number.isFinite(rawSize) && rawSize >= 0 ? rawSize : 0,
        contentType,
        lastModified,
      }
    },

    async lazy(path: string): Promise<StreamFile | null> {
      const cleanPath = normalizeStoragePath(path)
      const meta = await this.head(cleanPath)
      if (!meta) return null

      const fileName = basenameOfStoragePath(cleanPath)
      return new StreamFile(
        {
          byteLength: meta.size,
          stream(start = 0, end = meta.size): ReadableStream<Uint8Array<ArrayBuffer>> {
            const boundedStart = Math.max(0, Math.min(start, meta.size))
            const boundedEnd = Math.max(boundedStart, Math.min(end, meta.size))
            if (boundedStart >= boundedEnd) {
              return new ReadableStream<Uint8Array<ArrayBuffer>>({
                start(c) {
                  c.close()
                },
              })
            }

            let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
            const rangeHeader = `bytes=${boundedStart}-${boundedEnd - 1}`

            return new ReadableStream<Uint8Array<ArrayBuffer>>({
              async pull(controller) {
                if (!reader) {
                  const res = await signedFetch(objectUrlOf(cleanPath), {
                    method: 'GET',
                    headers: { range: rangeHeader },
                  })
                  if (!res.ok || !res.body) {
                    const detail = await res.text().catch(() => '')
                    throw new Error(
                      `[storage/s3] GET ${rangeHeader} failed (${res.status}): ${detail.slice(0, 200)}`,
                    )
                  }
                  reader = res.body.getReader()
                }

                const { done, value } = await reader.read()
                if (done) {
                  reader.releaseLock()
                  reader = null
                  controller.close()
                  return
                }
                const copy = new Uint8Array(new ArrayBuffer(value.byteLength))
                copy.set(value)
                controller.enqueue(copy)
              },
              async cancel(reason) {
                if (reader) {
                  await reader.cancel(reason).catch(() => undefined)
                  reader.releaseLock()
                  reader = null
                }
              },
            })
          },
        },
        fileName,
        { type: meta.contentType, lastModified: meta.lastModified },
      )
    },

    async del(path: string): Promise<boolean> {
      const cleanPath = normalizeStoragePath(path)
      const res = await signedFetch(objectUrlOf(cleanPath), { method: 'DELETE' })
      await res.body?.cancel().catch(() => undefined)
      if (res.status === 404) return false
      if (!res.ok) {
        throw new Error(`[storage/s3] DELETE failed (${res.status}) for «${cleanPath}»`)
      }
      return true
    },
  }
}
