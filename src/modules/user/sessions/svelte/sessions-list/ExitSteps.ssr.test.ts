// @vitest-environment node
import { render } from 'svelte/server'
import { describe, expect, test } from 'vitest'
import ExitSteps from './ExitSteps.svelte'

const ACTION = '/user/sessions?/others'
const A = '11111111-1111-4111-8111-111111111111'

describe('ExitSteps: серверный набор, размер от total', () => {
  test('сводка показывает размер среза и ссылку подтверждения', () => {
    const { body } = render(ExitSteps, {
      props: { action: ACTION, total: 3, step: 'summary', confirmHref: '/user/sessions?sessions-exit=confirm' },
    })
    expect(body).toContain('Будет завершено сессий:')
    expect(body).toContain('<strong>3</strong>')
    expect(body).toContain('data-testid="bulk-exit-next"')
  })

  test('одна строка — обычная кнопка, две и больше — удержание', () => {
    const one = render(ExitSteps, { props: { action: ACTION, total: 1, step: 'confirm' } })
    expect(one.body).toContain('data-testid="bulk-exit-submit"')
    expect(one.body).not.toContain('data-mass-hold')

    const many = render(ExitSteps, { props: { action: ACTION, total: 2, step: 'confirm' } })
    expect(many.body).toContain('data-mass-hold="true"')
    expect(many.body).toContain('data-testid="bulk-exit-hold"')
  })

  test('без текущей сессии чекбокса нет; с текущей — есть', () => {
    const without = render(ExitSteps, { props: { action: ACTION, total: 2, step: 'confirm' } })
    expect(without.body).not.toContain('name="include_current"')
    const with_ = render(ExitSteps, { props: { action: ACTION, total: 2, currentId: A, step: 'confirm' } })
    expect(with_.body).toContain('name="include_current"')
  })

  test('снятый чекбокс исключает текущую из размера, отмеченный — включает', () => {
    const without = render(ExitSteps, { props: { action: ACTION, total: 3, currentId: A, step: 'summary' } })
    expect(without.body).toContain('<strong>2</strong>')
    const with_ = render(ExitSteps, { props: { action: ACTION, total: 3, currentId: A, includeCurrent: true, step: 'summary' } })
    expect(with_.body).toContain('<strong>3</strong>')
  })

  test('spread: снятый чекбокс — одна текущая, отмеченный — весь срез', () => {
    const one = render(ExitSteps, { props: { action: '/user/logout?/exit', currentId: A, total: 3, spread: true, step: 'summary' } })
    expect(one.body).toContain('<strong>1</strong>')
    const all = render(ExitSteps, { props: { action: '/user/logout?/exit', currentId: A, total: 3, spread: true, includeCurrent: true, step: 'summary' } })
    expect(all.body).toContain('<strong>3</strong>')
  })

  test('форма несёт фильтр и spread, но не клиентские ids/pick', () => {
    const { body } = render(ExitSteps, {
      props: { action: ACTION, total: 2, step: 'confirm', filters: { state: 'expired', country: 'RU' } },
    })
    expect(body).toContain('name="state"')
    expect(body).toContain('value="expired"')
    expect(body).toContain('name="country"')
    expect(body).toContain('value="RU"')
    expect(body).toContain('name="spread"')
    expect(body).not.toContain('name="ids"')
    expect(body).not.toContain('name="pick"')
    expect(body).toContain(`action="${ACTION}"`)
  })
})
