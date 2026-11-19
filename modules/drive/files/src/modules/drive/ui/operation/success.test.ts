import { describe, expect, it } from 'vitest'
import { driveSuccess } from './success.js'

describe('driveSuccess', () => {
  it('stay на странице уходит на next, как 303 без JS', () => {
    expect(driveSuccess({ success: 'stay', inModal: false, redirect: '/drive?drive=1' })).toEqual({
      kind: 'goto',
      href: '/drive?drive=1',
    })
  })

  it('target уходит на next, stay остаётся/закрывает', () => {
    expect(driveSuccess({ success: 'target', inModal: false, redirect: '/drive/x' })).toEqual({
      kind: 'goto',
      href: '/drive/x',
    })
    expect(driveSuccess({ success: 'stay', inModal: true, redirect: '/drive/x' })).toEqual({
      kind: 'close',
    })
  })

  it('без redirect страница просто закрывает слой', () => {
    expect(driveSuccess({ success: 'stay', inModal: false, redirect: null })).toEqual({
      kind: 'close',
    })
  })
})
