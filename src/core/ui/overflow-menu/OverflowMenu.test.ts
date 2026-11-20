import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import OverflowMenu from './OverflowMenu.svelte'

const items = [
  { id: 'open', label: 'Открыть', href: '/drive/open' },
  { id: 'copy', label: 'Копировать', href: '/drive/copy' },
  { id: 'delete', label: 'Удалить', onClick: () => {}, destructive: true },
] as const

describe('OverflowMenu без хоста (SSR/no-JS)', () => {
  it('fallback показывает все ссылки и не показывает onClick-пункты', () => {
    const { body } = render(OverflowMenu, { props: { items: [...items], maxVisible: 1, 'data-testid': 'node-actions' } })
    expect(body).toContain('data-overflow-fallback')
    expect(body).toContain('href="/drive/open"')
    expect(body).toContain('href="/drive/copy"')
    expect(body).not.toContain('Удалить')
    expect(body).not.toContain('aria-haspopup')
  })

  it('fallback="none" — ничего не рендерит', () => {
    const { body } = render(OverflowMenu, { props: { items: [...items], fallback: 'none' } })
    expect(body).not.toContain('data-overflow-fallback')
    expect(body).not.toContain('href="/drive/open"')
  })

  it('fallback="wrap" переносит, без скрытия скроллбара', () => {
    const { body } = render(OverflowMenu, { props: { items: [...items], fallback: 'wrap' } })
    expect(body).toContain('flex-wrap')
    expect(body).not.toContain('scrollbar-width')
  })
})
