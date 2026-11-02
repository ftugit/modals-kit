// @vitest-environment happy-dom
import { mount, tick, unmount } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import { describe, expect, it, vi } from 'vitest'
import ProfileModal from './ProfileModal.svelte'
import Profile from './Profile.svelte'
import type { ProfileRouteData } from '../types.js'

const mock = vi.hoisted(() => ({ state: null as unknown as Map<string, unknown>, preload: vi.fn() }))
vi.mock('$app/navigation', () => ({ preloadData: mock.preload }))
vi.mock('#lib/modals/svelte/index.js', () => ({
  useModal: () => ({ get params() { return { id: mock.state.get('uid') } } }),
  useLoader: () => ({ get data() { return mock.state.get('data') } }),
}))
vi.mock('#hooks/links/index.js', () => ({
  useModalLink: () => () => ({ href: '/' }),
}))
vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/'), state: {}, data: {} },
  navigating: { to: null, from: null, type: null },
}))

const uid = '11111111-1111-4111-8111-111111111111'
const full = (name: string): ProfileRouteData => ({
  uid,
  profile: { id: uid, authId: uid, nickname: name, avatarUrl: null, createdAt: 1, updatedAt: 1 },
  publicProfile: null,
  isOwn: false,
  visibility: 'nobody',
  notCreated: false,
  canEdit: false,
  canDeleteProfile: false,
  canDeleteSeed: false,
  fullBlock: null,
  blocks: [],
  canReadBlocks: false,
  canBlock: false,
  canOpenConfig: false,
  fact: null,
  enabled: true,
  limits: { nicknameForbidden: [] },
})

describe('ProfileModal: ACL относится к текущему ответу', () => {
  it('успешный SWR того же uid снимает отказ, не размонтируя носитель', async () => {
    const state = new SvelteMap<string, unknown>()
    mock.state = state
    state.set('uid', uid)
    state.set('data', { ...full('x'), profile: null, fact: 'auth.identity-unknown' })
    const target = document.createElement('div')
    document.body.append(target)
    const app = mount(ProfileModal, { target })
    try {
      await tick()
      expect(target.querySelector('[data-acl-code=not_found]')).not.toBeNull()
      state.set('data', full('Актуальный профиль'))
      await tick()
      expect(target.querySelector('[data-acl-code=not_found]')).toBeNull()
      expect(target.textContent).toContain('Актуальный профиль')
    } finally {
      await unmount(app)
      target.remove()
    }
  })
})

describe('Profile: асинхронная подгрузка', () => {
  it('не применяет старый ответ после перехода A → B → A', async () => {
    const state = new SvelteMap<string, string>([['uid', uid]])
    const pending: Array<(result: unknown) => void> = []
    mock.preload.mockImplementation(() => new Promise((resolve) => pending.push(resolve)))
    const target = document.createElement('div')
    document.body.append(target)
    const app = mount(Profile, { target, props: { get uid() { return state.get('uid')! } } })
    try {
      await tick()
      state.set('uid', '22222222-2222-4222-8222-222222222222')
      await tick()
      state.set('uid', uid)
      await tick()
      expect(pending).toHaveLength(3)
      pending[0]!({ type: 'loaded', data: full('Устаревший профиль') })
      await tick()
      expect(target.textContent).not.toContain('Устаревший профиль')
      expect(target.querySelector('[data-testid=profile-pending]')).not.toBeNull()
      pending[2]!({ type: 'loaded', data: full('Новый профиль') })
      await tick()
      expect(target.textContent).toContain('Новый профиль')
    } finally {
      await unmount(app)
      target.remove()
      mock.preload.mockReset()
    }
  })
})

describe('Profile: смена проекции', () => {
  it('меняет полный профиль на публичный и обратно без утечки старых действий', async () => {
    const state = new SvelteMap<string, ProfileRouteData>()
    state.set('route', { ...full('Частный профиль'), canEdit: true, canOpenConfig: true })
    const target = document.createElement('div')
    document.body.append(target)
    const app = mount(Profile, { target, props: { uid, get route() { return state.get('route')! } } })
    try {
      await tick()
      expect(target.textContent).toContain('Частный профиль')
      expect(target.querySelector('[data-testid=profile-config-open]')).not.toBeNull()
      state.set('route', { ...full('x'), profile: null, publicProfile: { nickname: 'Публичный профиль', avatarUrl: null, createdAt: 1 } })
      await tick()
      expect(target.textContent).toContain('Публичный профиль')
      expect(target.textContent).not.toContain('Частный профиль')
      expect(target.textContent).not.toContain('Редактировать')
      expect(target.querySelector('[data-testid=profile-config-open]')).toBeNull()
      state.set('route', { ...full('Обновлённый профиль'), canOpenConfig: true })
      await tick()
      expect(target.textContent).toContain('Обновлённый профиль')
      expect(target.textContent).not.toContain('Публичный профиль')
      expect(target.querySelector('[data-testid=profile-config-open]')).not.toBeNull()
    } finally {
      await unmount(app)
      target.remove()
    }
  })
})
