import { describe, expect, it, vi } from 'vitest'
import { readTaskStream, TASK_STREAM_ACCEPT } from '#lib/fetch/index.js'
import type { TaskState } from '#lib/task/index.js'
import { currentReport, taskResponse, type TaskReport } from './task-stream.server.js'

const ask = (accept = TASK_STREAM_ACCEPT) => new Request('http://x/api', { headers: { accept } })
const step = (done: number): TaskState => ({
  status: 'pending', scope: 'global', label: 'Запуск базы', progress: { kind: 'steps', done, total: 4 },
})
const json = (body: unknown, init?: ResponseInit) =>
  Response.json(body, { ...init, headers: { etag: '"e1"', 'cache-control': 'no-store', ...init?.headers } })

describe('taskResponse', () => {
  it('клиент строк не просил — ответ обработчика как есть', async () => {
    const res = json({ a: 1 })
    expect(await taskResponse(ask('application/json'), async () => res)).toBe(res)
  })

  it('ждать нечего — ответ байт в байт прежний (тот же объект)', async () => {
    const res = json({ a: 1 })
    expect(await taskResponse(ask(), async () => res)).toBe(res)
  })

  it('«жду» раньше результата — строки, последняя собирается в тот же ответ', async () => {
    const res = await taskResponse(ask(), async () => {
      currentReport()!(step(1))
      await Promise.resolve()
      currentReport()!(step(3))
      return json({ items: [1, 2] })
    })
    expect(res.headers.get('content-type')).toContain('application/x-ndjson')
    const seen: unknown[] = []
    const back = await readTaskStream(res, (t) => seen.push(t))
    expect(seen).toEqual([step(1), step(3)])
    expect(back.status).toBe(200)
    expect(back.headers.get('etag')).toBe('"e1"')
    expect(await back.json()).toEqual({ items: [1, 2] })
  })

  it('ошибка после начала строк — настоящий код и тело в последней строке (решение 1)', async () => {
    const res = await taskResponse(ask(), async () => {
      currentReport()!(step(1))
      return Response.json({ error: 'база недоступна', code: 'unavailable' }, { status: 503 })
    })
    expect(res.status).toBe(200)
    const back = await readTaskStream(res, () => {})
    expect(back.status).toBe(503)
    expect(await back.json()).toEqual({ error: 'база недоступна', code: 'unavailable' })
  })

  it('исключение после начала строк — 500 с общим текстом; до начала — пробрасывается', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await taskResponse(ask(), async () => {
      currentReport()!(step(1))
      throw new Error('boom')
    })
    const back = await readTaskStream(res, () => {})
    expect(back.status).toBe(500)
    expect((await back.json()).code).toBe('internal')
    await expect(taskResponse(ask(), async () => Promise.reject(new Error('early')))).rejects.toThrow('early')
    spy.mockRestore()
  })

  it('текстовый ответ возвращается текстом', async () => {
    const res = await taskResponse(ask(), async () => {
      currentReport()!(step(0))
      return new Response('a\t1\nb\t2', { headers: { 'content-type': 'text/plain; charset=utf-8' } })
    })
    expect(await (await readTaskStream(res, () => {})).text()).toBe('a\t1\nb\t2')
  })

  it('подписка watch: ход общей операции, отписка после ответа', async () => {
    let listener: TaskReport | undefined
    const stop = vi.fn()
    const watch = (report: TaskReport) => {
      listener = report
      report(step(2)) // операция уже идёт — сразу её текущий ход
      return stop
    }
    const res = await taskResponse(ask(), async () => json({ ok: true }), { watch: [watch] })
    expect(stop).toHaveBeenCalledOnce()
    listener!(step(4)) // после ответа — в никуда
    const seen: unknown[] = []
    await readTaskStream(res, (t) => seen.push(t))
    expect(seen).toEqual([step(2)])
  })

  it('вне taskResponse отчёта нет', () => {
    expect(currentReport()).toBeUndefined()
  })
})

describe('taskResponse: клиент ушёл', () => {
  it('отмена потока до результата не роняет процесс и не пишет в закрытый поток', async () => {
    let finish!: () => void
    const res = await taskResponse(ask(), async () => {
      currentReport()!(step(1))
      await new Promise<void>((r) => (finish = r))
      currentReport()!(step(2))
      return json({ ok: true })
    })
    await res.body!.cancel()
    finish()
    await new Promise((r) => setTimeout(r, 10))
    // дошли сюда — исключения из close/enqueue не было
    expect(res.bodyUsed).toBe(true)
  })
})
