import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import FormMessage from './FormMessage.svelte'

describe('FormMessage', () => {
  it('error: alert и destructive', () => {
    const { body } = render(FormMessage, { props: { message: 'Неверный диапазон' } })
    expect(body).toContain('role="alert"')
    expect(body).toContain('text-destructive')
    expect(body).toContain('Неверный диапазон')
  })

  it('muted: status, но переданный role сильнее', () => {
    const muted = render(FormMessage, { props: { message: 'Подсказка', variant: 'muted' } })
    expect(muted.body).toContain('role="status"')
    const custom = render(FormMessage, { props: { message: 'x', variant: 'muted', role: 'note' } })
    expect(custom.body).toContain('role="note"')
  })

  it('без message и children ничего не рисует', () => {
    const { body } = render(FormMessage, { props: {} })
    expect(body).not.toContain('data-slot="form-message"')
  })
})
