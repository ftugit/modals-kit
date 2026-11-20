import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import { createRawSnippet } from 'svelte'
import EntryCard from './EntryCard.svelte'

const html = (markup: string) => createRawSnippet(() => ({ render: () => markup }))

describe('EntryCard', () => {
  it('рисует заголовок h2, описание и действия', () => {
    const { body } = render(EntryCard, {
      props: {
        title: 'Диск',
        description: 'Папки и файлы с квотой.',
        actions: html('<button>Открыть</button>'),
        'data-testid': 'drive-entry',
      },
    })
    expect(body).toContain('<h2')
    expect(body).toContain('Диск')
    expect(body).toContain('Папки и файлы с квотой.')
    expect(body).toContain('Открыть')
    expect(body).toContain('data-slot="entry-card"')
    expect(body).toContain('data-testid="drive-entry"')
    expect(body).toContain('role="region"')
  })

  it('muted — вариант карточки', () => {
    const { body } = render(EntryCard, { props: { title: 'Пусто', variant: 'muted' } })
    expect(body).toContain('data-variant="muted"')
  })
})
