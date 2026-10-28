import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createStorage, memoryDriver, normalizeStoragePath, StreamFile } from './index.js'
import { localDriver } from './local.js'

const tempDirs: string[] = []

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    await rm(dir, { recursive: true, force: true })
  }
})

describe('StreamFile', () => {
  it('passes instanceof File/Blob, appends to FormData without buffering, and slices lazily', async () => {
    const requestedRanges: Array<[number, number]> = []
    const sf = new StreamFile(
      {
        byteLength: 10 * 1024 * 1024,
        stream(start = 0, end = 10 * 1024 * 1024) {
          requestedRanges.push([start, end])
          const len = end - start
          const buf = new Uint8Array(new ArrayBuffer(len))
          buf.fill(0x5a)
          return new ReadableStream({
            start(controller) {
              controller.enqueue(buf)
              controller.close()
            },
          })
        },
      },
      'video.mp4',
      { type: 'video/mp4', lastModified: 1700000000000 },
    )

    expect(sf instanceof File).toBe(true)
    expect(sf instanceof Blob).toBe(true)
    expect(sf.size).toBe(10 * 1024 * 1024)

    const fd = new FormData()
    fd.append('attachment', sf)
    expect(fd.get('attachment')).toBe(sf)
    expect(requestedRanges).toEqual([])

    const head = await sf.slice(0, 64).bytes()
    expect(head.byteLength).toBe(64)
    expect(head[0]).toBe(0x5a)
    expect(requestedRanges).toEqual([[0, 64]])
  })
})

describe('normalizeStoragePath', () => {
  it('normalizes relative POSIX paths and blocks traversal / reserved prefixes', () => {
    expect(normalizeStoragePath('/uploads/2026/photo.jpg')).toBe('uploads/2026/photo.jpg')
    expect(() => normalizeStoragePath('')).toThrow()
    expect(() => normalizeStoragePath('../secret.txt')).toThrow()
    expect(() => normalizeStoragePath('a/../../b')).toThrow()
    expect(() => normalizeStoragePath('a\\b.txt')).toThrow()
    expect(() => normalizeStoragePath('.storage-tmp/x')).toThrow()
  })
})

describe('localDriver + createStorage', () => {
  it('streams >5 MiB into a single disk file, serves 206 Partial Content & HEAD, and cleans up .part on abort', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'modals-kit-storage-'))
    tempDirs.push(rootDir)

    const storage = createStorage({
      servers: {
        local: localDriver({ rootDir, publicBaseUrl: '/api/upload-demo/files' }),
        mem: memoryDriver({ publicBaseUrl: 'https://cdn.example/files' }),
      },
      defaultServer: 'local',
    })

    // 5.5 MiB > Vercel 4.5 MB limit, streamed in 256 KiB chunks
    const totalBytes = 22 * 256 * 1024
    let produced = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (produced >= totalBytes) {
          controller.close()
          return
        }
        const chunk = new Uint8Array(256 * 1024)
        const idx = produced / (256 * 1024)
        chunk.fill(idx & 0xff)
        produced += chunk.byteLength
        controller.enqueue(chunk)
      },
    })

    const saved = await storage.put({
      path: 'demos/large.bin',
      body,
      size: totalBytes,
      contentType: 'application/octet-stream',
    })

    expect(saved.size).toBe(totalBytes)
    expect(saved.server).toBe('local')
    expect(saved.url).toBe('/api/upload-demo/files/demos/large.bin')

    // Verify only 1 file exists in demos/ and 0 leftover .part files in .storage-tmp
    const demoFiles = await readdir(join(rootDir, 'demos'))
    expect(demoFiles).toEqual(['large.bin'])
    const tmpFiles = await readdir(join(rootDir, '.storage-tmp'))
    expect(tmpFiles).toEqual([])

    // Range 206 across chunk boundary (bytes 262140-262147 spans chunk 0 [0x00] and chunk 1 [0x01])
    const rangeRes = await storage.serve(
      'demos/large.bin',
      new Request('http://localhost/api/upload-demo/files/demos/large.bin', {
        headers: { range: 'bytes=262140-262147' },
      }),
    )
    expect(rangeRes.status).toBe(206)
    expect(rangeRes.headers.get('content-range')).toBe(`bytes 262140-262147/${totalBytes}`)
    const rangeBytes = new Uint8Array(await rangeRes.arrayBuffer())
    expect([...rangeBytes]).toEqual([0, 0, 0, 0, 1, 1, 1, 1])

    // HEAD request
    const headRes = await storage.serve(
      'demos/large.bin',
      new Request('http://localhost/api/upload-demo/files/demos/large.bin', { method: 'HEAD' }),
    )
    expect(headRes.status).toBe(200)
    expect(headRes.headers.get('content-length')).toBe(String(totalBytes))

    // Mid-stream abort cleans up .part and never creates target file
    const abortCtl = new AbortController()
    let sentBeforeAbort = 0
    const brokenStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sentBeforeAbort === 0) {
          sentBeforeAbort += 65536
          controller.enqueue(new Uint8Array(65536).fill(7))
          return
        }
        abortCtl.abort(new Error('socket disconnected'))
      },
    })

    await expect(
      storage.put({
        path: 'demos/aborted.bin',
        body: brokenStream,
        size: 1024 * 1024,
        signal: abortCtl.signal,
      }),
    ).rejects.toThrow()

    expect(await storage.head('demos/aborted.bin')).toBeNull()
    expect(await readdir(join(rootDir, '.storage-tmp'))).toEqual([])

    // Delete cleans up both file and metadata
    expect(await storage.del('demos/large.bin')).toBe(true)
    expect(await storage.head('demos/large.bin')).toBeNull()
  })
})
