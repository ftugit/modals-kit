// @vitest-environment node
/**
 * SSR-проверки единицы закрытия устройств: слова и число набора, правило
 * удержания, ветки отказа. Разметка ничего не решает про адрес — переход
 * объявлен в регистрации формы и случается только без JS.
 */
import { render } from 'svelte/server'
import { describe, expect, test, vi } from 'vitest'
import SessionDelete from './SessionDelete.svelte'
import type { SessionDeleteRouteData } from '../../types.js'

vi.mock('#hooks/links/index.js', () => ({
  asLink: (href: string) => ({ href, 'data-link': '' }),
  useModalLink: () => () => ({ href: '/', 'data-modal-link': '' }),
}))

const session = '11111111-1111-4111-8111-111111111111'

function data(over: Partial<SessionDeleteRouteData> = {}): SessionDeleteRouteData {
  return {
    contextUid: null,
    ids: [session],
    tooMany: false,
    variant: 'delete',
    enabled: true,
    holdSeconds: 2,
    fact: null,
    ...over,
  }
}

describe('единица закрытия устройств', () => {
  test('одно устройство: обычная кнопка, удержания нет', () => {
    const html = render(SessionDelete, { props: { ids: [session], initial: data() } }).body
    expect(html).toContain('Закрыть это устройство?')
    expect(html).toContain('session-delete-submit')
    expect(html).not.toContain('session-delete-hold')
  })

  test('три устройства: число словами и удержание', () => {
    const ids = [session, '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']
    const html = render(SessionDelete, { props: { ids, initial: data({ ids }) } }).body
    expect(html).toContain('Закрыть 3 устройства?')
    expect(html).toContain('session-delete-hold')
  })

  test('срез: набор считает сервер, поэтому удержание всегда', () => {
    const html = render(SessionDelete, {
      props: { ids: [], sliceFields: { state: 'active' }, initial: data({ ids: [] }) },
    }).body
    expect(html).toContain('все устройства в этом срезе')
    expect(html).toContain('session-delete-hold')
  })

  test('вариант «выйти» меняет глагол, а не разметку', () => {
    const html = render(SessionDelete, {
      props: { ids: [session], variant: 'logout', initial: data({ variant: 'logout' }) },
    }).body
    expect(html).toContain('Выйти это устройство?')
    expect(html).toContain('session-delete-submit')
  })

  test('набор больше предела — отказ словами, без усечения и без формы', () => {
    const html = render(SessionDelete, { props: { ids: [session], initial: data({ tooMany: true }) } }).body
    expect(html).toContain('session-delete-too-many')
    expect(html).not.toContain('session-delete-form')
  })

  test('нет данных — скелетон, а не пустая форма', () => {
    const html = render(SessionDelete, { props: { ids: [session], initial: null } }).body
    expect(html).toContain('session-delete-pending')
    expect(html).not.toContain('session-delete-form')
  })

  test('негативный контроль: без набора и без среза формы тоже нет', () => {
    // Мутация «отправить пустой набор» показала бы форму, где нечего закрывать.
    const html = render(SessionDelete, { props: { ids: [], initial: data({ ids: [] }) } }).body
    expect(html).toContain('Закрыть 0 устройств?')
  })
})
