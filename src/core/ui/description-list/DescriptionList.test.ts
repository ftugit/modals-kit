import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import { createRawSnippet } from 'svelte'
import DescriptionList from './DescriptionList.svelte'
import DescriptionListItem from './DescriptionListItem.svelte'

const html = (markup: string) => createRawSnippet(() => ({ render: () => markup }))

describe('DescriptionList', () => {
  it('responsive по умолчанию, compact даёт мелкий текст', () => {
    const { body } = render(DescriptionList, {
      props: { children: html('<dt>A</dt><dd>B</dd>'), variant: 'compact' },
    })
    expect(body).toContain('data-layout="responsive"')
    expect(body).toContain('text-xs')
    expect(body).toContain('sm:grid-cols-[auto_1fr]')
  })

  it('item рисует dt/dd, значение по умолчанию — тире', () => {
    const { body } = render(DescriptionList, {
      props: { children: html('') },
    })
    expect(body).toContain('data-slot="description-list"')

    const pair = render(DescriptionListItem, { props: { label: 'Адрес' } })
    expect(pair.body).toContain('<dt')
    expect(pair.body).toContain('<dd')
    expect(pair.body).toContain('Адрес')
    expect(pair.body).toContain('—')
  })

  it('truncate и title у значения', () => {
    const { body } = render(DescriptionListItem, {
      props: { label: 'Путь', value: '/very/long/path', truncate: true, title: '/very/long/path' },
    })
    expect(body).toContain('truncate')
    expect(body).toContain('title="/very/long/path"')
  })
})
