// Модульные тесты серверного приёма (lib/form/server.ts): без сети, на Request/FormData.
import { describe as suite, expect, test, vi } from 'vitest'
import { buildEnvelope, defineForm, makeFieldSugar } from './index'
import { createFormHandler, windowThrottle } from './server'

const field = makeFieldSugar()
const base = defineForm({ id: 'probe', fields: { name: field.text({}) } })

const envelopeOf = (extra: Record<string, unknown> = {}, d = base) =>
  buildEnvelope({
    formId: d.id, revision: d.revision, instance: `${d.id}:new`,
    submissionId: crypto.randomUUID(), ...extra,
  }, d.policy)

const post = (entries: Record<string, string>, headers: Record<string, string> = {}) =>
  new Request('http://x/form', {
    method: 'POST', body: new URLSearchParams(entries),
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  })

suite('переход после успеха (F17)', () => {
  const redirectOf = async (target: string) => {
    const h = createFormHandler({ description: base, execute: (c) => { c.commit(); return { redirect: target } } })
    return (await h(post({ ...envelopeOf(), name: 'a' }))).result.redirect
  }

  test('чужой хост не проходит ни в каком написании', async () => {
    for (const evil of ['//evil.com', '/\\evil.com', '/\t/evil.com', '/\n/evil.com', '\\/evil.com',
                        'https://evil.com', 'evil.com', '/\\/evil.com'])
      expect(await redirectOf(evil), JSON.stringify(evil)).toBeUndefined()
  })

  test('свой путь отдаётся нормализованным', async () => {
    expect(await redirectOf('/ok')).toBe('/ok')
    expect(await redirectOf('/a/b?x=1#h')).toBe('/a/b?x=1#h')
    expect(await redirectOf('/%2F%2Fevil.com')).toBe('/%2F%2Fevil.com')
  })
})

suite('сбой вне execute', () => {
  test('текст исключения не уходит клиенту, но доступен телеметрии', async () => {
    const seen: Record<string, unknown>[] = []
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const h = createFormHandler({
      description: base,
      source: { resolve: async () => { throw new Error('ECONNREFUSED 10.0.0.5:5432 user=app') }, revision: async () => 1 },
      observe: (e) => { seen.push(e) },
      execute: (c) => { c.commit(); return {} },
    })
    const r = await h(post({ ...envelopeOf(), name: 'a' }))
    quiet.mockRestore()
    expect(r.status).toBe(500)
    expect(r.result.errors.map((e) => e.code)).toEqual(['handler.failed'])
    expect(JSON.stringify(r.result)).not.toContain('ECONNREFUSED')
    expect(String(seen[0]?.['failure'])).toContain('ECONNREFUSED')
  })
})

suite('частота (F18)', () => {
  const req = (ip = '1.1.1.1') => ({ request: new Request('http://x/', { headers: { 'x-real-ip': ip } }) })

  test('без ключа ограничитель не создаётся: подделываемого умолчания нет', () => {
    expect(() => windowThrottle({ limit: 1, windowMs: 1000 } as never)).toThrow(/key обязателен/)
  })

  test('лимит считается по заданному ключу', () => {
    const t = windowThrottle({ limit: 2, windowMs: 1000, key: (r) => r.headers.get('x-real-ip')! }, () => 0)
    expect(t.check(req()).allowed).toBe(true)
    expect(t.check(req()).allowed).toBe(true)
    expect(t.check(req())).toEqual({ allowed: false, retryAfterMs: 1000 })
    expect(t.check(req('2.2.2.2')).allowed).toBe(true)
  })

  test('окна без попаданий удаляются: память не растёт с числом разовых ключей', () => {
    let now = 0
    const t = windowThrottle({ limit: 5, windowMs: 1000, key: (r) => r.headers.get('x-real-ip')! }, () => now)
    for (let i = 0; i < 500; i++) t.check(req(`10.0.${i >> 8}.${i & 255}`))
    expect(t.size).toBe(500)
    now = 1500
    t.check(req('9.9.9.9'))
    expect(t.size).toBe(1)
  })
})
