import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import Empty from './Empty.svelte'

describe('Empty', () => {
  it('рисует заголовок, описание, роль и testid', () => {
    const { body } = render(Empty, {
      props: {
        title: 'Токенов нет',
        description: 'Создайте первый пароль приложения',
        role: 'alert',
        'data-testid': 'empty-tokens',
      },
    })
    expect(body).toContain('Токенов нет')
    expect(body).toContain('Создайте первый пароль приложения')
    expect(body).toContain('role="alert"')
    expect(body).toContain('data-testid="empty-tokens"')
  })

  it('dashed — пунктирная рамка без заливки', () => {
    const { body } = render(Empty, { props: { title: 'Пусто', variant: 'dashed' } })
    expect(body).toContain('border-dashed')
    expect(body).not.toContain('bg-card')
  })

  it('plain без рамки', () => {
    const { body } = render(Empty, { props: { title: 'Пусто', variant: 'plain' } })
    expect(body).not.toContain('border')
  })
})
