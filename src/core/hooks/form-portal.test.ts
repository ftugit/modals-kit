// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { associatePortalControls } from './form-portal.js'

describe('associatePortalControls', () => {
  it('привязывает новые контролы и очищает только собственные атрибуты', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<input name="first"><select form="other"></select><button>Save</button>'
    const [input, select, button] = root.querySelectorAll('input, select, button')
    const stop = associatePortalControls(root, 'original', { cleanup: true })
    expect(input.getAttribute('form')).toBe('original')
    expect(select.getAttribute('form')).toBe('other')
    const wrapper = document.createElement('div')
    wrapper.innerHTML = '<textarea></textarea>'
    const later = wrapper.firstElementChild!
    root.append(wrapper)
    await Promise.resolve()
    expect(later.getAttribute('form')).toBe('original')
    button.setAttribute('form', 'changed')
    stop()
    expect(input.hasAttribute('form')).toBe(false)
    expect(later.hasAttribute('form')).toBe(false)
    expect(button.getAttribute('form')).toBe('changed')
    expect(select.getAttribute('form')).toBe('other')
  })

  it('оставляет атрибуты при закрытии и отменяет отложенный кадр', () => {
    const root = document.createElement('div')
    root.innerHTML = '<input>'
    const request = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(123)
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {})
    try {
      const stop = associatePortalControls(root, 'form-id', { nextFrame: true })
      stop()
      expect(request).toHaveBeenCalledOnce()
      expect(cancel).toHaveBeenCalledWith(123)
      expect(root.querySelector('input')?.getAttribute('form')).toBe('form-id')
    } finally {
      request.mockRestore()
      cancel.mockRestore()
    }
  })
})
