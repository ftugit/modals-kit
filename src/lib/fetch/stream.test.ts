import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { TaskState } from '#lib/task/index.js'
import { FetchError } from './errors.js'
import { fetchWithTask, readTaskStream, TASK_STREAM_ACCEPT, type StreamTask } from './stream.js'

const ndjson = (...lines: string[]) =>
  new Response(lines.join('\n') + '\n', { headers: { 'content-type': 'application/x-ndjson; charset=utf-8' } })

describe('readTaskStream', () => {
  it('обычный ответ без длины — тот же объект', async () => {
    const res = new Response(new ReadableStream({ start: (c) => c.close() }))
    expect(await readTaskStream(res, () => {})).toBe(res)
  })

  it('обычный ответ с длиной — ход байтами, тело то же', async () => {
    const body = JSON.stringify({ x: 'y'.repeat(100) })
    const res = new Response(body, { status: 201, headers: { 'content-length': String(body.length), etag: '"a"' } })
    const seen: StreamTask[] = []
    const back = await readTaskStream(res, (t) => seen.push(t))
    expect(back.status).toBe(201)
    expect(back.headers.get('etag')).toBe('"a"')
    expect(await back.text()).toBe(body)
    expect(seen.at(-1)).toEqual({ status: 'pending', scope: 'local', progress: { kind: 'bytes', loaded: body.length, total: body.length } })
  })

  it('последняя строка без завершающего \\n — не обрыв', async () => {
    const res = new Response(
      '{"task":{"status":"pending","scope":"global"}}\n{"result":{"status":200,"headers":{"content-type":"application/json"},"body":{"ok":true}}}',
      { headers: { 'content-type': 'application/x-ndjson' } },
    )
    const seen: StreamTask[] = []
    const back = await readTaskStream(res, (t) => seen.push(t))
    expect(seen).toHaveLength(1)
    expect(back.status).toBe(200)
    expect(await back.json()).toEqual({ ok: true })
  })

  it('строки: ход по порядку, результат — с кодом и заголовками', async () => {
    const seen: StreamTask[] = []
    const back = await readTaskStream(
      ndjson(
        '{"task":{"status":"pending","scope":"global","progress":{"kind":"steps","done":1,"total":2}}}',
        '{"result":{"status":422,"headers":{"content-type":"application/json","x-k":"v"},"body":{"error":"нет"}}}',
      ),
      (t) => seen.push(t),
    )
    expect(seen).toHaveLength(1)
    expect(back.status).toBe(422)
    expect(back.headers.get('x-k')).toBe('v')
    expect(await back.json()).toEqual({ error: 'нет' })
  })

  it('304 из строки — без тела', async () => {
    const back = await readTaskStream(ndjson('{"result":{"status":304,"headers":{"etag":"\\"e\\""}}}'), () => {})
    expect(back.status).toBe(304)
    expect(back.body).toBeNull()
  })

  it('обрыв до результата — fetch.network; кривая строка — fetch.parse', async () => {
    await expect(readTaskStream(ndjson('{"task":{"status":"pending","scope":"local"}}'), () => {})).rejects.toMatchObject({
      code: 'fetch.network',
    })
    const err = await readTaskStream(ndjson('{oops'), () => {}).catch((e) => e)
    expect(err).toBeInstanceOf(FetchError)
    expect(err.code).toBe('fetch.parse')
  })
})

describe('fetchWithTask', () => {
  it('без onTask — обычный fetch без своего accept; с ним — accept строк и чтение хода', async () => {
    const seen: (string | null)[] = []
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      seen.push(new Headers(init?.headers).get('accept'))
      return ndjson('{"task":{"status":"pending","scope":"local","label":"Очередь"}}', '{"result":{"status":200,"text":"ok"}}')
    })
    await fetchWithTask('http://x/a')
    const tasks: StreamTask[] = []
    const res = await fetchWithTask('http://x/a', { onTask: (t) => tasks.push(t) })
    expect(seen).toEqual([null, TASK_STREAM_ACCEPT])
    expect(await res.text()).toBe('ok')
    expect(tasks).toEqual([{ status: 'pending', scope: 'local', label: 'Очередь' }])
    spy.mockRestore()
  })

  it('ход — тот же формат, что TaskState, без зависимости от #lib/task', () => {
    expectTypeOf<StreamTask>().toExtend<TaskState>()
  })
})
