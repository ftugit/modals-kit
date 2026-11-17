// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
  parseAuthStage,
  userAccountSessionsDeleteRoute,
  userSessionsDeleteRoute,
} from './routes.js'

describe('parseAuthStage: адрес шагов и плоские значения', () => {
  test('полный ключ цепочки шагов (`auth.register`) — та же стадия', () => {
    // Хост шагов пишет в `?stage` полный ключ (`auth` + аддон formSteps);
    // серверный рендер и no-JS обязаны открывать именно эту стадию.
    expect(parseAuthStage('auth.register')).toBe('register')
    expect(parseAuthStage('auth.restore')).toBe('restore')
    expect(parseAuthStage('auth.entry')).toBe('entry')
  })

  test('плоские значения и стадии хоста — как раньше', () => {
    expect(parseAuthStage('register')).toBe('register')
    expect(parseAuthStage('profile')).toBe('profile')
    expect(parseAuthStage('blocked')).toBe('blocked')
    expect(parseAuthStage('restrictions')).toBe('restrictions')
  })

  test('мусор и пустота — entry', () => {
    expect(parseAuthStage('auth.banana')).toBe('entry')
    expect(parseAuthStage('banana')).toBe('entry')
    expect(parseAuthStage('')).toBe('entry')
    expect(parseAuthStage(undefined)).toBe('entry')
    expect(parseAuthStage(null)).toBe('entry')
  })
})

describe('адреса единицы закрытия набора (S2)', () => {
  const session = '11111111-1111-4111-8111-111111111111'
  const other = '22222222-2222-4222-8222-222222222222'
  const account = '33333333-3333-4333-8333-333333333333'

  test('свой адрес абсолютен и несёт набор с вариантом', () => {
    const href = userSessionsDeleteRoute.href({ id: session, ids: `${session},${other}`, variant: 'logout' })
    expect(href.startsWith('/user/sessions/delete?')).toBe(true)
    expect(href).toContain(`id=${session}`)
    expect(href).toContain('variant=logout')
  })

  test('адрес переданной цели держит аккаунт в пути, а набор — в `ids`', () => {
    const href = userAccountSessionsDeleteRoute.href({ id: account }, { ids: session, variant: 'delete' })
    expect(href.startsWith(`/user/${account}/sessions/delete`)).toBe(true)
    expect(href).toContain(`ids=${session}`)
    // Ключ `id` у этого адреса занят сегментом пути: набор одиночного случая
    // приходит набором из одного элемента, а не вторым `id`.
    expect(href.includes('&id=')).toBe(false)
  })

  test('разбор адреса: вариант из закрытого списка, пустое — null', () => {
    expect(userSessionsDeleteRoute.parse(`?id=${session}&variant=logout`)).toMatchObject({
      id: session,
      ids: null,
      variant: 'logout',
    })
    expect(userSessionsDeleteRoute.parse('?variant=banana')).toMatchObject({ variant: 'delete' })
    expect(userSessionsDeleteRoute.parse('')).toMatchObject({ id: null, ids: null, variant: 'delete' })
    expect(userAccountSessionsDeleteRoute.parse(`?ids=${session}`)).toMatchObject({
      ids: session,
      variant: 'delete',
    })
  })

  test('негативный контроль: относительный адрес проваливает правило', () => {
    // Мутация «собрать путь строкой без ведущего слэша» — то, что ломал S0.
    const naive = `user/sessions/delete?id=${session}`
    expect(naive.startsWith('/')).toBe(false)
    expect(userSessionsDeleteRoute.href({ id: session }).startsWith('/')).toBe(true)
  })
})
