import { render } from 'svelte/server'
import { describe, expect, test } from 'vitest'
import TimeAgo from './TimeAgo.svelte'

const NOW = Date.parse('2026-10-27T12:00:00Z')

describe('TimeAgo SSR', () => {
  test('относительный текст, полная дата в title, ISO в datetime', () => {
    const { body } = render(TimeAgo, { props: { value: NOW - 5 * 60_000, now: NOW } })
    expect(body).toContain('5 минут назад')
    expect(body).toContain('<time')
    expect(body).toContain(`datetime="${new Date(NOW - 5 * 60_000).toISOString()}"`)
    expect(body).toContain('title="27 октября 2026 г. в ')
  })

  test('старше месяца — абсолютная дата', () => {
    const { body } = render(TimeAgo, { props: { value: NOW - 40 * 24 * 3600_000, now: NOW } })
    expect(body).not.toContain('назад')
    expect(body).toContain('сентября')
  })
})
