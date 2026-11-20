import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import { createRawSnippet } from 'svelte'
import Surface from './Surface.svelte'

const html = (markup: string) =>
  createRawSnippet(() => ({ render: () => markup }))

describe('Surface.rail', () => {
  it('рисует навигацию и тело', () => {
    const { body } = render(Surface, {
      props: {
        title: 'Настройки',
        rail: html('<a href="/settings/account">Аккаунт</a>'),
        railLabel: 'Разделы настроек',
        children: html('<p data-body>Содержимое</p>'),
      },
    })
    expect(body).toContain('data-surface-rail')
    expect(body).toContain('aria-label="Разделы настроек"')
    expect(body).toContain('href="/settings/account"')
    expect(body).toContain('data-body')
  })

  it('без rail разметка прежняя', () => {
    const { body } = render(Surface, { props: { title: 'Список', children: html('<p>ok</p>') } })
    expect(body).not.toContain('data-surface-rail')
    expect(body).toContain('data-surface-body')
  })
})
