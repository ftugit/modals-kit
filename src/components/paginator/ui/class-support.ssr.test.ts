import { render } from 'svelte/server'
import { describe, expect, test } from 'vitest'
import PageDivider from './PageDivider.svelte'
import StatusRow from './StatusRow.svelte'

/**
 * Поддержка `class` у UI-компонентов пагинатора — как у `Acl`: потребитель
 * передаёт классы корневому элементу, они добавляются через `cn` к базовым,
 * а не заменяют их.
 */
describe('paginator UI: class у компонентов', () => {
  test('StatusRow: class добавляется к базовым классам корня', () => {
    const { body } = render(StatusRow, { props: { text: 'Загрузка…', class: 'my-custom-row' } })
    expect(body).toContain('my-custom-row')
    expect(body).toContain('text-muted-foreground')
  })

  test('PageDivider: class добавляется к базовым классам корня', () => {
    const { body } = render(PageDivider, { props: { page: 3, class: 'my-custom-divider' } })
    expect(body).toContain('my-custom-divider')
    expect(body).toContain('uppercase')
  })

  test('без class разметка прежняя', () => {
    const { body } = render(StatusRow, { props: { text: 'Готово' } })
    expect(body).toContain('py-2')
    expect(body).not.toContain('my-custom')
  })
})
