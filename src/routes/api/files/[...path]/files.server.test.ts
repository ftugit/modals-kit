import { describe, expect, it } from 'vitest'
import { resolveRequestStorage } from '#server/storage.server.js'
import { GET, HEAD } from './+server.js'

function makeCookieJar() {
  const map = new Map<string, string>()
  return {
    get: (name: string) => map.get(name),
    getAll: () => [...map.entries()].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => {
      map.set(name, value)
    },
    delete: (name: string) => {
      map.delete(name)
    },
    serialize: (name: string, value: string) => `${name}=${value}`,
    parse: () => ({}),
  } as any
}

function deterministicBytes(length: number, seed = 67): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(length))
  for (let i = 0; i < length; i++) {
    out[i] = (i * 43 + seed) & 0xff
  }
  return out
}

describe('/api/files/[...path] и resolveRequestStorage — нарезка split и все режимы скачивания', () => {
  it('режет файл > 512 КБ по shard_a + shard_b (AES-256-GCM) и склеивает при скачивании с Range 206 по шву, RFC 5987 именем и concurrency 429', async () => {
    const cookies = makeCookieJar()
    const storage = await resolveRequestStorage(cookies, { writeStrategy: 'round-robin' })

    // 700 КБ > лимита одного шарда 512 КБ -> полосато режется на 2 части (shard_a + shard_b)
    const payload = deterministicBytes(700 * 1024, 29)
    const testPath = `demo-test/split-${Date.now()}.bin`

    try {
      const stored = await storage.put({
        path: testPath,
        body: new Blob([payload], { type: 'application/octet-stream' }),
        size: payload.byteLength,
        stageToDisk: true,
        server: 'auto',
        split: true,
        splitServers: ['shard_a', 'shard_b'],
      })
      expect(stored.partsCount).toBe(2)
      expect(stored.encrypted).toBe(true)
      const stat = await storage.stat(testPath)
      expect(stat?.parts.map((p) => p.server)).toEqual(['shard_a', 'shard_b'])
      const seamOffset = stat!.parts[0]!.plainBytes

      // 1. HEAD через роут /api/files/[...path]
      const headUrl = new URL(
        `http://localhost/api/files/${testPath}?download=1&name=${encodeURIComponent('Отчёт по склейке (1).bin')}`,
      )
      const headRes = await HEAD({
        params: { path: testPath },
        request: new Request(headUrl, { method: 'HEAD' }),
        url: headUrl,
        cookies,
      } as any)
      expect(headRes.status).toBe(200)
      expect(headRes.headers.get('accept-ranges')).toBe('bytes')
      expect(headRes.headers.get('content-length')).toBe(String(payload.byteLength))

      // 2. GET с Range прямо поперёк точного шва между shard_a и shard_b!
      const seamStart = seamOffset - 40
      const seamEnd = seamOffset + 39
      const rangeReq = new Request(headUrl, {
        headers: { Range: `bytes=${seamStart}-${seamEnd}` },
      })
      const rangeRes = await GET({
        params: { path: testPath },
        request: rangeReq,
        url: headUrl,
        cookies,
      } as any)
      expect(rangeRes.status).toBe(206)
      expect(rangeRes.headers.get('content-disposition')).toContain(
        "filename*=UTF-8''%D0%9E%D1%82%D1%87%D1%91%D1%82%20%D0%BF%D0%BE%20%D1%81%D0%BA%D0%BB%D0%B5%D0%B9%D0%BA%D0%B5%20%281%29.bin",
      )
      const seamBytes = new Uint8Array(await rangeRes.arrayBuffer())
      expect(seamBytes).toEqual(payload.subarray(seamStart, seamEnd + 1))

      // 3. Проверка условного GET (If-None-Match -> 304) и inline-отдачи без download=1
      const etag = headRes.headers.get('etag')!
      const condRes = await GET({
        params: { path: testPath },
        request: new Request(headUrl, { headers: { 'If-None-Match': etag } }),
        url: headUrl,
        cookies,
      } as any)
      expect(condRes.status).toBe(304)

      const inlineUrl = new URL(`http://localhost/api/files/${testPath}`)
      const inlineRes = await GET({
        params: { path: testPath },
        request: new Request(inlineUrl, { headers: { Range: 'bytes=0-15' } }),
        url: inlineUrl,
        cookies,
      } as any)
      expect(inlineRes.status).toBe(206)
      expect(inlineRes.headers.get('content-disposition')).toBeNull()
      expect(new Uint8Array(await inlineRes.arrayBuffer())).toEqual(payload.subarray(0, 16))

      // 4. Проверка межинстансового семафора скачивания: concurrency=reject_1 даёт 429 при втором параллельном чтении
      const concUrl = new URL(`http://localhost/api/files/${testPath}?concurrency=reject_1`)
      const res1 = await GET({
        params: { path: testPath },
        request: new Request(concUrl),
        url: concUrl,
        cookies,
      } as any)
      expect(res1.status).toBe(200)
      const reader1 = res1.body!.getReader()
      const firstChunk = await reader1.read()
      expect(firstChunk.done).toBe(false)

      const res2 = await GET({
        params: { path: testPath },
        request: new Request(concUrl),
        url: concUrl,
        cookies,
      } as any)
      expect(res2.status).toBe(429)

      await reader1.cancel()
    } finally {
      await storage.del(testPath)
    }
  })
})
