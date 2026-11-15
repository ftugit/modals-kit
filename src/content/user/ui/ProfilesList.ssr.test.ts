import { render } from 'svelte/server'
import { describe, expect, test, vi } from 'vitest'
import ProfilesList from './ProfilesList.svelte'
import type { ProfilesRouteData } from './profiles/source.js'
import { profilesSnapshot } from './profiles/source.js'

vi.mock('$app/navigation', () => ({
  afterNavigate: () => {},
  beforeNavigate: () => {},
  goto: async () => {},
  preloadData: async () => ({ type: 'not_found' }),
}))
vi.mock('$app/env', () => ({ browser: false }))
const addr = vi.hoisted(() => ({ url: new URL('http://localhost/profiles') }))
vi.mock('$app/state', () => ({
  page: { get url() { return addr.url }, state: {}, data: {} },
  navigating: { to: null, from: null, type: null },
}))
vi.mock('#hooks/links/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#hooks/links/index.js')>()
  return {
    ...actual,
    useModalLink: () => (name: string, params: Record<string, unknown> = {}) => ({
      href: `/profiles`,
      'data-modal-link': '',
    }),
  }
})

describe('ProfilesList SSR', () => {
  test('рендерит никнейм из initial', () => {
    const initial: ProfilesRouteData = {
      snapshot: profilesSnapshot(
        {
          items: [{ id: 'p1', authId: 'a1', nickname: 'alice', avatarUrl: null, createdAt: 1000, updatedAt: 1000 }],
          total: 1,
          page: 1,
          pageSize: 30,
        },
        {},
      ),
      fact: null,
      enabled: true,
    }
    const { body } = render(ProfilesList, { props: { initial, variant: 'card' } })
    expect(body).toContain('alice')
  })

  test('пустой список рендерится без ошибки', () => {
    const initial: ProfilesRouteData = {
      snapshot: profilesSnapshot(
        { items: [], total: 0, page: 1, pageSize: 30 },
        {},
      ),
      fact: null,
      enabled: true,
    }
    const { body } = render(ProfilesList, { props: { initial, variant: 'card' } })
    expect(body).toContain('Профили')
  })
})