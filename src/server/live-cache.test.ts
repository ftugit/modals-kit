/**
 * Память условного GET — проверка того, что «304» действительно значит «не читали».
 *
 * Разметать это на живом сервере нельзя: «база не тронута» снаружи не видно,
 * видно только статус. Поэтому здесь проверяются три границы, на которых такой
 * кэш обычно и ломается: время, запись и чужой ключ.
 */
import { describe, expect, it } from 'vitest'
import {
  etagMatches,
  fingerprint,
  invalidateLiveCache,
  LIVE_CACHE_TTL_MS,
  liveCacheSize,
  remember,
  revalidate,
  stableText,
} from './live-cache.server.js'

describe('память условного GET /api/db-posts', () => {
  it('свёрнутый и развёрнутый отпечаток эквивалентны, `*` — любой', () => {
    expect(etagMatches('W/"abc"', 'W/"abc"')).toBe(true)
    expect(etagMatches('"abc"', 'W/"abc"')).toBe(true)
    expect(etagMatches('W/"abc", W/"def"', 'W/"def"')).toBe(true)
    expect(etagMatches('*', 'W/"что-угодно"')).toBe(true)
    expect(etagMatches(null, 'W/"abc"')).toBe(false)
    expect(etagMatches('W/"abc"', 'W/"abd"')).toBe(false)
  })

  it('без заголовка условия — никогда не 304 (обычная навигация читает всегда)', () => {
    invalidateLiveCache()
    remember('a', 'W/"1"')
    expect(revalidate('a', null)).toBeNull()
    expect(revalidate('a', 'W/"1"')).toBe('W/"1"')
  })

  it('ключ разный — ответ разный: чужой отпечаток не даёт 304', () => {
    invalidateLiveCache()
    remember('?page=1&size=5', 'W/"p1"')
    expect(revalidate('?page=2&size=5', 'W/"p1"')).toBeNull()
    expect(revalidate('?page=1&size=5', 'W/"p1"')).toBe('W/"p1"')
  })

  it('запись обесценивает память СРАЗУ, не дожидаясь TTL', () => {
    invalidateLiveCache()
    remember('a', 'W/"1"')
    expect(revalidate('a', 'W/"1"')).toBe('W/"1"')
    invalidateLiveCache()
    expect(revalidate('a', 'W/"1"')).toBeNull()
    expect(liveCacheSize()).toBe(0)
  })

  it('после TTL память отдаёт 200, каким бы ни был отпечаток', () => {
    invalidateLiveCache()
    remember('a', 'W/"1"', 1_000)
    // Два тика опроса (2 с и 4 с) после ответа 200 обязаны уйти в 304: при TTL
    // короче интервала память не экономила бы ни одного чтения базы.
    expect(revalidate('a', 'W/"1"', 3_000)).toBe('W/"1"')
    expect(revalidate('a', 'W/"1"', 5_000)).toBe('W/"1"')
    expect(revalidate('a', 'W/"1"', 1_000 + LIVE_CACHE_TTL_MS + 1)).toBeNull() // TTL + 1 мс — истекло
  })

  it('память ограничена: 65-й ключ вытесняет самый старый, а не все подряд', () => {
    invalidateLiveCache()
    for (let i = 0; i < 65; i += 1) remember(`k${i}`, `W/"${i}"`)
    expect(liveCacheSize()).toBe(64)
    expect(revalidate('k0', 'W/"0"')).toBeNull() // вытеснен
    expect(revalidate('k64', 'W/"64"')).toBe('W/"64"')
  })

  it('отпечаток зависит от байт ответа и стабилен', async () => {
    const a = await fingerprint(JSON.stringify({ items: [1, 2, 3] }))
    const b = await fingerprint(JSON.stringify({ items: [1, 2, 3] }))
    const c = await fingerprint(JSON.stringify({ items: [1, 2, 4] }))
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^W\/"[0-9a-f]{24}"$/)
  })

  it('переподписанный указатель не меняет отпечаток, другая строка — меняет', async () => {
    const row = { id: '1', title: 'Пост', created_at: '2026-10-10T12:00:00.000Z' }
    const tick1 = { items: [row], hasNext: true, extra: { after: 'tok.sig-1' } }
    const tick2 = { items: [row], hasNext: true, extra: { after: 'tok.sig-2' } }
    const changed = { items: [{ ...row, title: 'Другой' }], hasNext: true, extra: { after: 'tok.sig-3' } }
    expect(await fingerprint(stableText(tick1))).toBe(await fingerprint(stableText(tick2)))
    expect(await fingerprint(stableText(tick1))).not.toBe(await fingerprint(stableText(changed)))
    // Прочие ключи extra — часть данных и в отпечаток входят.
    expect(stableText({ items: [], extra: { after: 'x', mode: 'a' } })).toBe('{"items":[],"extra":{"mode":"a"}}')
    expect(stableText({ items: [], totalItems: 0 })).toBe('{"items":[],"totalItems":0}')
  })
})
