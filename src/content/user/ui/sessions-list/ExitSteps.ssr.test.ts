import { render } from 'svelte/server'
import { describe, expect, test, vi } from 'vitest'
import ExitSteps from './ExitSteps.svelte'

// Компонент берёт сессию пользователя для отправки формы; в SSR она не нужна.
vi.mock('../../vault.svelte.js', () => ({
  userSession: {
    ensureFresh: async () => true,
    onAuthExpired: () => {},
  },
}))

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

const count = (body: string): string => {
  const m = /data-testid="bulk-exit-count"[^>]*>.*?<strong>([^<]*)<\/strong>/.exec(body)
  return m ? m[1]! : ''
}

describe('ExitSteps: набор, чекбокс и удержание', () => {
  test('сводка показывает размер набора и ссылку «Далее»', () => {
    const { body } = render(ExitSteps, {
      props: { ids: [A, B], pick: 'only', step: 'summary', confirmHref: '/user/logout?step=confirm' },
    })
    expect(count(body)).toBe('2')
    expect(body).toContain('data-testid="bulk-exit-next"')
    expect(body).toContain('href="/user/logout?step=confirm"')
    expect(body).not.toContain('data-mass-hold')
  })

  test('одна строка — обычная кнопка, две и больше — удержание', () => {
    const one = render(ExitSteps, { props: { ids: [A], pick: 'only', step: 'confirm' } })
    expect(one.body).toContain('data-testid="bulk-exit-submit"')
    expect(one.body).not.toContain('data-mass-hold="true"')

    const many = render(ExitSteps, { props: { ids: [A, B], pick: 'only', step: 'confirm' } })
    expect(many.body).toContain('data-mass-hold="true"')
    expect(many.body).toContain('data-testid="bulk-exit-hold"')
    expect(many.body).not.toContain('data-testid="bulk-exit-submit"')
  })

  test('`only`: снятый чекбокс убирает текущую сессию из набора — удержание снимается', () => {
    const without = render(ExitSteps, {
      props: { ids: [A, B], pick: 'only', currentId: A, step: 'confirm' },
    })
    expect(without.body).not.toContain('data-mass-hold="true"')
    expect(without.body).toContain('data-testid="bulk-exit-submit"')

    const with_ = render(ExitSteps, {
      props: { ids: [A, B], pick: 'only', currentId: A, includeCurrent: true, step: 'confirm' },
    })
    expect(with_.body).toContain('data-mass-hold="true"')
  })

  test('`except`: размер набора — total минус исключения, чекбокс возвращает текущую в набор', () => {
    const except = render(ExitSteps, {
      props: { ids: [A], pick: 'except', currentId: A, total: 5, step: 'summary' },
    })
    expect(count(except.body)).toBe('4')

    const all = render(ExitSteps, {
      props: { ids: [A], pick: 'except', currentId: A, total: 5, includeCurrent: true, step: 'summary' },
    })
    expect(count(all.body)).toBe('5')
  })

  test('форма уносит намерение, pick и набор id; скрытые поля видны без JS', () => {
    const { body } = render(ExitSteps, {
      props: {
        ids: [A, B, C],
        pick: 'only',
        currentId: A,
        step: 'confirm',
        action: '/user/sessions?/others',
      },
    })
    expect(body).toContain('action="/user/sessions?/others"')
    expect(body).toContain('name="pick"')
    expect(body).toContain('value="only"')
    // Набор уходит одним скрытым полем: значения склеены запятой, сервер
    // режет их по разделителю сам.
    expect(body).toContain('name="ids"')
    expect(body).toContain(`value="${[A, B, C].join(',')}"`)
    expect(body).toContain('name="include_current"')
  })

  test('`spread`: снятый чекбокс — одна текущая сессия, отмеченный — весь аккаунт', () => {
    // Экран выхода: тот же компонент, чекбокс раздвигает набор, а не впускает
    // в него текущую сессию. Размер решает удержание.
    const one = render(ExitSteps, {
      props: { ids: [A], pick: 'only', currentId: A, total: 3, spread: true, step: 'confirm' },
    })
    expect(one.body).not.toContain('data-mass-hold="true"')
    expect(one.body).toContain('data-testid="bulk-exit-submit"')

    const all = render(ExitSteps, {
      props: {
        ids: [A],
        pick: 'only',
        currentId: A,
        total: 3,
        spread: true,
        includeCurrent: true,
        step: 'confirm',
      },
    })
    expect(all.body).toContain('data-mass-hold="true"')

    // Негативный контроль: одна сессия в аккаунте — удержания нет и при
    // отмеченном чекбоксе.
    const single = render(ExitSteps, {
      props: { ids: [A], pick: 'only', currentId: A, total: 1, spread: true, includeCurrent: true, step: 'summary' },
    })
    expect(count(single.body)).toBe('1')
    expect(single.body).not.toContain('data-mass-hold')
  })

  test('без текущей сессии чекбокса нет', () => {
    const { body } = render(ExitSteps, { props: { ids: [A, B], pick: 'only', step: 'confirm' } })
    expect(body).not.toContain('name="include_current"')
    expect(body).toContain('data-mass-hold="true"')
  })
})
