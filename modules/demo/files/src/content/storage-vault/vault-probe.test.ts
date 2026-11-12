import { describe, expect, it } from 'vitest'
import { probeStorageVaultEntry } from './vault.form.server.js'

describe('probeStorageVaultEntry — проверка сервера ДО сохранения в куки-сейфе', () => {
  it('отклоняет недоступный S3 или неверные ключи (403) до записи куки', async () => {
    const forbiddenFetch: typeof fetch = async () =>
      new Response('<Error><Code>InvalidAccessKeyId</Code></Error>', { status: 403 })

    const res = await probeStorageVaultEntry(
      'bad_s3',
      {
        url: 's3://wrongKey:wrongSecret@s3.us-east-005.backblazeb2.com/my-bucket',
        storageMb: 100,
        fileMb: 20,
        readOnly: false,
      },
      forbiddenFetch,
    )

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.path).toEqual(['url'])
      expect(res.message).toContain('bad_s3')
    }
  })

  it('отклоняет HTML-страницу входа вместо WebDAV (200 без multistatus) даже в режиме readOnly', async () => {
    const htmlLoginFetch: typeof fetch = async () =>
      new Response('<html><body>Please sign in</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })

    const res = await probeStorageVaultEntry(
      'fake_dav',
      {
        url: 'webdav://user:pass@cloud.example.com/dav',
        storageMb: 100,
        fileMb: 20,
        readOnly: true,
      },
      htmlLoginFetch,
    )

    expect(res.ok).toBe(false)
  })

  it('пропускает рабочий S3-сервер после полного цикла put -> read -> del (включая AES-256-GCM)', async () => {
    const objects = new Map<string, Uint8Array>()

    const mockS3Fetch: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      const method = (init?.method ?? 'GET').toUpperCase()
      const key = url.pathname

      if (method === 'PUT') {
        const buf = init?.body
          ? new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer())
          : new Uint8Array(0)
        objects.set(key, buf)
        return new Response(null, { status: 200, headers: { etag: '"probe-etag"' } })
      }

      if (method === 'HEAD') {
        const hit = objects.get(key)
        if (!hit) return new Response(null, { status: 404 })
        return new Response(null, {
          status: 200,
          headers: {
            'content-length': String(hit.byteLength),
            'content-type': 'application/octet-stream',
            etag: '"probe-etag"',
          },
        })
      }

      if (method === 'GET') {
        const hit = objects.get(key)
        if (!hit) return new Response('NotFound', { status: 404 })
        const rangeHeader = new Headers(init?.headers).get('range')
        if (rangeHeader) {
          const m = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader)
          if (m) {
            const s = Number(m[1])
            const e = Math.min(hit.byteLength - 1, Number(m[2]))
            const slice = hit.slice(s, e + 1)
            return new Response(slice, {
              status: 206,
              headers: {
                'content-length': String(slice.byteLength),
                'content-range': `bytes ${s}-${e}/${hit.byteLength}`,
              },
            })
          }
        }
        return new Response(hit.slice(), {
          status: 200,
          headers: { 'content-length': String(hit.byteLength) },
        })
      }

      if (method === 'DELETE') {
        objects.delete(key)
        return new Response(null, { status: 204 })
      }

      return new Response('Unsupported', { status: 405 })
    }

    const res = await probeStorageVaultEntry(
      'good_s3',
      {
        url: 's3://validKey:validSecret@s3.us-east-005.backblazeb2.com/my-bucket/sub',
        storageMb: 512,
        fileMb: 64,
        readOnly: false,
        encryptionKey: 'vault-probe-encryption-passphrase',
      },
      mockS3Fetch,
    )

    expect(res).toEqual({ ok: true })
    // Пробник гарантированно удалён после проверки
    expect(objects.size).toBe(0)
  })
})
