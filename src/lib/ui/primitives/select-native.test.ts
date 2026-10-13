import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import Select from './Select.svelte'
import type { SelectOption } from './select-model'

/**
 * Серверная разметка — то, что видит браузер без JavaScript. До гидратации
 * `nativeLimit` оставляет первые N опций по порядку `options` плюс выбранное;
 * без предела (0, умолчание) в разметке весь список.
 */
const options: SelectOption[] = Array.from({ length: 10 }, (_, i) => ({ value: `v${i}`, label: `Опция ${i}` }))

/** Значения опций нативного контрола без пустого варианта-заглушки. */
function nativeValues(html: string): string[] {
  return [...html.matchAll(/<option\b[^>]*\bvalue="([^"]*)"/g)].map((m) => m[1]!).filter((v) => v !== '')
}

describe('Select: нативный список до гидратации', () => {
  it('без nativeLimit — все опции', () => {
    const { body } = render(Select, { props: { options, name: 'f', multiple: true } })
    expect(nativeValues(body)).toEqual(options.map((o) => o.value))
  })

  it('nativeLimit — первые N по порядку options', () => {
    const { body } = render(Select, { props: { options, name: 'f', multiple: true, config: { nativeLimit: 3 } } })
    expect(nativeValues(body)).toEqual(['v0', 'v1', 'v2'])
  })

  it('выбранное за пределом остаётся в списке и выбрано', () => {
    const { body } = render(Select, {
      props: { options, name: 'f', multiple: true, value: ['v1', 'v8'], config: { nativeLimit: 3 } },
    })
    expect(nativeValues(body)).toEqual(['v0', 'v1', 'v2', 'v8'])
    expect(body).toMatch(/<option\b[^>]*value="v8"[^>]*selected/)
  })

  it('список не длиннее предела — без изменений', () => {
    const { body } = render(Select, { props: { options: options.slice(0, 3), name: 'f', config: { nativeLimit: 3 } } })
    expect(nativeValues(body)).toEqual(['v0', 'v1', 'v2'])
  })
})
