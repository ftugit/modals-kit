import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import { createRawSnippet } from 'svelte'
import Item from './Item.svelte'
import ItemTitle from './ItemTitle.svelte'
import ItemContent from './ItemContent.svelte'
import ItemMedia from './ItemMedia.svelte'
import ItemActions from './ItemActions.svelte'

const html = (markup: string) => createRawSnippet(() => ({ render: () => markup }))

const body = () => html('<span>media</span><span data-slot="item-content"><span data-slot="item-title">Файл</span></span><span data-slot="item-actions">A</span>')

describe('Item family', () => {
  it('Item рисует строку с медиа, контентом и действиями', () => {
    const { body: out } = render(Item, {
      props: { children: body(), 'data-testid': 'row' },
    })
    expect(out).toContain('data-slot="item"')
    expect(out).toContain('data-variant="outline"')
    // listitem без родителя role=list — нарушение ARIA; роль задаёт носитель.
    expect(out).not.toContain('role="listitem"')
    expect(out).toContain('data-testid="row"')
    expect(out).toContain('<span>media</span>')
    expect(out).toContain('data-slot="item-actions"')
  })

  it('as=li остаётся семантическим элементом списка', () => {
    const { body: out } = render(Item, { props: { as: 'li', children: html('<span>x</span>') } })
    expect(out).toContain('<li')
    expect(out).not.toContain('role="listitem"')
  })

  it('selected добавляет aria-selected и акцент', () => {
    const { body: out } = render(Item, { props: { selected: true, children: html('<span>x</span>') } })
    expect(out).toContain('aria-selected="true"')
    expect(out).toContain('bg-accent/40')
  })

  it('title truncate и as=h3', () => {
    const { body: out } = render(ItemTitle, { props: { as: 'h3', truncate: true, children: html('Длинное имя') } })
    expect(out).toContain('<h3')
    expect(out).toContain('truncate')
  })
})
