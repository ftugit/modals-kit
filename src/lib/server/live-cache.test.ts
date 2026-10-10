/**
 * Память условного GET — проверка того, что «304» действительно значит «не читали».
 *
 * Разметать это на живом сервере нельзя: «база не тронута» снаружи не видно,
 * видно только статус. Поэтому здесь проверяются три границы, на которых такой
 * кэш обычно и ломается: время, запись и чужой ключ.
 */
import { describe, expect, it } from 'vitest'
import { etagMatches, fingerprint, invalidateLiveCache, liveCacheSize, remember, revalidate } from './live-cache'

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
    expect(revalidate('a', 'W/"1"', 2_000)).toBe('W/"1"') // 1 с — живём (тик опроса = 2 с)
    expect(revalidate('a', 'W/"1"', 2_501)).toBeNull() // 1.5 с + 1 мс — истекло
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
})
