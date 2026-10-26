/** Схема модуля: фундамент без «demo», связи и ключевые свойства полей. */
import { describe, expect, test } from 'vitest'
import { auth, profile, profileFields, session } from './schema.js'

describe('схема пользователя (user_auth / user_profile / user_session)', () => {
  test('ключи и таблицы — без «demo»', () => {
    expect(auth.key).toBe('user.auth.v1')
    expect(auth.table).toBe('public.user_auth')
    expect(profile.key).toBe('user.profile.v1')
    expect(profile.table).toBe('public.user_profile')
    expect(session.key).toBe('user.session.v1')
    expect(session.table).toBe('public.user_session')
  })

  test('seed обнуляем (вайп), профиль связан цепочкой, jti уникален', () => {
    const seed = auth.fields.seed as unknown as { nullable?: boolean; db?: { unique?: boolean } }
    expect(seed.nullable).toBe(true)
    expect(seed.db?.unique).toBe(true)
    const link = profile.fields.auth_id as unknown as { db?: { references?: { chain?: boolean } } }
    expect(link.db?.references?.chain).toBe(true)
    const jti = session.fields.jti as unknown as { db?: { unique?: boolean } }
    expect(jti.db?.unique).toBe(true)
    const history = session.fields.subnet_history as unknown as { nullable?: boolean }
    expect(history.nullable).toBe(true)
  })

  test('avatar_url: http(s) и dataURL картинок проходят, мусор — нет', async () => {
    const v = (x: unknown) => profileFields.avatar_url['~standard'].validate(x)
    expect((await v('https://example.com/a.png')).issues).toBeUndefined()
    // dataURL — продукт клиентского конвейера аватара (раньше схема его
    // отклоняла и сохранение падало 500; содержимое проверяет роут по спеке)
    expect((await v('data:image/jpeg;base64,/9j/4AAQ')).issues).toBeUndefined()
    expect((await v('data:image/webp;base64,UklGRg==')).issues).toBeUndefined()
    expect((await v(null)).issues).toBeUndefined()
    expect((await v('data:text/html;base64,PGI+')).issues).toBeDefined()
    expect((await v('data:image/svg+xml;base64,PHN2Zz4=')).issues).toBeDefined()
    expect((await v('javascript:alert(1)')).issues).toBeDefined()
  })

  test('account.read: список аккаунтов и удалённые строки видны по праву', () => {
    const reader = { principal: { id: 'someone', roles: ['account.read'] } }
    const plain = { principal: { id: 'someone', roles: [] } }
    // с правом политика пропускает к любым строкам, без права — только к своей
    expect(auth.policy?.select?.(reader as never)).toBe(true)
    expect(auth.policy?.select?.(plain as never)).toEqual({ field: 'id', op: 'eq', value: 'someone' })
    const deleted = auth.softDelete as unknown as { readDeleted?: readonly string[] }
    expect(deleted.readDeleted).toContain('account.read')
  })

  test('у каждой таблицы свой порядок', () => {
    expect(auth.order).toEqual([['created_at', 'desc']])
    expect(profile.order).toEqual([['created_at', 'desc']])
    expect(session.order).toEqual([['created_at', 'desc']])
  })
})
