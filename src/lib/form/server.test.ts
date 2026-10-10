// Модульные тесты серверного приёма (lib/form/server.ts): без сети, на Request/FormData.
import { describe as suite, expect, test } from 'vitest'
import { buildEnvelope, defineForm, makeFieldSugar } from './index'
import { createFormHandler } from './server'

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
