import { describe, expect, it } from 'vitest'
import { pageBackFrom } from './back.js'

describe('pageBackFrom', () => {
  const current = 'http://local/drive'
  const href = '/drive'

  it('same-origin referrer с другой страницы — история', () => {
    expect(pageBackFrom({ referrer: 'http://local/drive/trash', current, href })).toBe('history')
  })

  it('пустой, внешний и тот же адрес — href', () => {
    expect(pageBackFrom({ referrer: '', current, href })).toBe(href)
    expect(pageBackFrom({ referrer: 'https://evil.example/', current, href })).toBe(href)
    expect(pageBackFrom({ referrer: 'http://local/drive', current, href })).toBe(href)
  })

  it('битый referrer — href', () => {
    expect(pageBackFrom({ referrer: 'not a url', current, href })).toBe(href)
  })
})
