import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { localPath, resetQueryClaims } from './index.js'
import {
  defineRoute,
  localPathSchema,
  objectSchema,
  querySchema,
  registerRoute,
  resetRegisteredRoutes,
} from './routes.js'

describe('#lib/address/routes', () => {
  beforeEach(() => {
    resetRegisteredRoutes()
    resetQueryClaims()
  })

  it('parses defaults, validates via StandardSchemaV1 (Zod v4 + objectSchema), and falls back safely on malformed query params', () => {
    const catalogRoute = registerRoute('/paginator', {
      keys: ['mode', 'limit', 'next'],
      defaults: { mode: 'grid', limit: 20, next: null },
      search: objectSchema({
        mode: z.enum(['grid', 'list']).default('grid'),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        next: localPathSchema,
      }),
    })

    const pureZodRoute = defineRoute('/cycle', {
      keys: ['step'],
      defaults: { step: 1 },
      search: z.object({
        step: z.coerce.number().int().min(1).max(10).default(1),
      }),
    })
    expect(pureZodRoute.parse('?step=3')).toEqual({ step: 3 })
    expect(pureZodRoute.parse('?step=999')).toEqual({ step: 1 })

    expect(catalogRoute.href()).toBe('/paginator')
    expect(catalogRoute.href({ mode: 'grid', limit: 20, next: null })).toBe('/paginator')
    expect(catalogRoute.href({ mode: 'list', limit: 40, next: '/fields?step=2' })).toBe(
      '/paginator?mode=list&limit=40&next=%2Ffields%3Fstep%3D2',
    )

    expect(catalogRoute.parse(new URL('http://localhost/paginator'))).toEqual({
      mode: 'grid',
      limit: 20,
      next: null,
    })
    expect(catalogRoute.parse('http://localhost/paginator?mode=list&limit=50&next=/form')).toEqual({
      mode: 'list',
      limit: 50,
      next: '/form',
    })
    // Битые значения из адресной строки не роняют SSR 500-й ошибкой, а откатываются к дефолтам схемы
    expect(catalogRoute.parse('?mode=hacked&limit=99999&next=//evil.com')).toEqual({
      mode: 'grid',
      limit: 20,
      next: null,
    })
  })

  it('rejects open-redirect vectors in localPath and localPathSchema', () => {
    const authRoute = registerRoute('/user/auth', {
      owner: 'user.auth',
      keys: ['stage', 'next'],
      defaults: { stage: 'auth.entry', next: null },
      search: querySchema<{ stage?: string; next?: string | null }, { stage: string; next: string | null }>((raw) => ({
        stage: typeof raw.stage === 'string' && raw.stage ? raw.stage : 'auth.entry',
        next: localPath(typeof raw.next === 'string' ? raw.next : null),
      })),
    })

    for (const malicious of [
      '//evil.com/phish',
      '/\\evil.com/phish',
      '/\t/evil.com/phish',
      'https://evil.com/phish',
      'javascript:alert(1)',
      'relative/path',
      '',
    ]) {
      expect(localPath(malicious), `vector: ${JSON.stringify(malicious)}`).toBeNull()
      expect(authRoute.parse(`?next=${encodeURIComponent(malicious)}`).next).toBeNull()
    }

    expect(authRoute.parse('?stage=restore&next=%2Ffields%3Ftab%3D1')).toEqual({
      stage: 'restore',
      next: '/fields?tab=1',
    })
  })

  it('preserves foreign query parameters in patch() and returns clean path when own params are cleared', () => {
    const authRoute = registerRoute('/user/auth', {
      owner: 'user.auth',
      keys: ['stage', 'next'],
      defaults: { stage: 'auth.entry', next: null },
    })

    expect(
      authRoute.patch(new URL('http://localhost/user/auth?modal=info&stage=login&utm=1'), {
        stage: 'register',
      }),
    ).toBe('/user/auth?modal=info&utm=1&stage=register')

    // Сброс собственного ключа оставляет чужие ключи, а при полном опустошении даёт чистый `/user/auth` (не `""`)
    expect(authRoute.patch('/user/auth?stage=login', { stage: 'auth.entry' })).toBe('/user/auth')
    expect(authRoute.patch('/user/auth?foreign=keep&stage=login', { stage: undefined })).toBe(
      '/user/auth?foreign=keep',
    )
  })

  it('supports parameterized paths and guards against duplicate route IDs and query-key collisions', () => {
    const cardRoute = defineRoute<{ id: string }, { tab?: string }>({
      id: 'cards.detail',
      keys: ['tab'],
      defaults: { tab: 'overview' },
      buildPath: ({ id }) => `/cards/${encodeURIComponent(id)}`,
    })

    expect(cardRoute.href({ id: '42' })).toBe('/cards/42')
    expect(cardRoute.href({ id: '42' }, { tab: 'reviews' })).toBe('/cards/42?tab=reviews')
    expect(cardRoute.patch('?modal=preview&tab=old', { id: '42' }, { tab: 'specs' })).toBe(
      '/cards/42?modal=preview&tab=specs',
    )

    registerRoute('/alpha', { keys: ['shared_filter'] })
    expect(() => registerRoute('/alpha')).toThrow(/уже зарегистрирован/)
    expect(() => registerRoute('/beta', { keys: ['shared_filter'] })).toThrow(/shared_filter/)
    expect(() => cardRoute.patch('?tab=reviews', { id: '42' }, {}, { drop: ['undeclared'] })).toThrow(/никем не забронирован/)
  })
})
