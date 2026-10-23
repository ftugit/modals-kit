// @vitest-environment happy-dom
import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import AttachmentHost from './AttachmentHost.test.svelte'

describe('Attachment component: object URL lifecycle, native selection, sibling actions, DOM validity', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  test('manages URL.createObjectURL / URL.revokeObjectURL strictly for visible local image File', async () => {
    let counter = 0
    const created: string[] = []
    const revoked: string[] = []

    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const next = `blob:attachment-test-${++counter}`
      created.push(next)
      return next
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
      revoked.push(url)
    })

    const target = document.createElement('div')
    document.body.append(target)

    const pdf = new File(['%PDF-1.7'], 'contract.pdf', { type: 'application/pdf' })
    const img1 = new File(['png-1'], 'first.png', { type: 'image/png' })
    const img2 = new File(['png-2'], 'second.png', { type: 'image/png' })

    const host = mount(AttachmentHost, { target, props: { initialFile: pdf } })
    await tick()

    const previewZone = target.querySelector('[data-testid="preview-zone"]')!
    expect(host.getRef()).toBeInstanceOf(HTMLDivElement)
    // Non-image local file never allocates an object URL.
    expect(created).toEqual([])
    expect(previewZone.querySelector('img')).toBeNull()

    // Image file allocates exactly one object URL and renders it strictly on <img>.
    host.setFile(img1)
    await tick()
    expect(created).toEqual(['blob:attachment-test-1'])
    expect(revoked).toEqual([])
    expect(previewZone.querySelector('img')?.getAttribute('src')).toBe('blob:attachment-test-1')
    expect(previewZone.querySelector('a[href^="blob:"]')).toBeNull()

    // Replacing File revokes the previous object URL immediately before creating the new one.
    host.setFile(img2)
    await tick()
    expect(created).toEqual(['blob:attachment-test-1', 'blob:attachment-test-2'])
    expect(revoked).toEqual(['blob:attachment-test-1'])
    expect(previewZone.querySelector('img')?.getAttribute('src')).toBe('blob:attachment-test-2')

    // Image load error immediately revokes its object URL and falls back to category icon.
    previewZone.querySelector('img')!.dispatchEvent(new Event('error'))
    await tick()
    expect(revoked).toEqual(['blob:attachment-test-1', 'blob:attachment-test-2'])
    expect(previewZone.querySelector('img')).toBeNull()
    expect(previewZone.querySelector('svg')).not.toBeNull()

    // Replacing with a fresh valid File recovers preview cleanly, then unmount revokes it.
    const img3 = new File(['png-3'], 'third.png', { type: 'image/png' })
    host.setFile(img3)
    await tick()
    expect(created).toEqual([
      'blob:attachment-test-1',
      'blob:attachment-test-2',
      'blob:attachment-test-3',
    ])

    await unmount(host)
    expect(revoked).toEqual([
      'blob:attachment-test-1',
      'blob:attachment-test-2',
      'blob:attachment-test-3',
    ])
    expect(host.getRef()).toBeNull()
    expect(host.getRefHistory().at(-1)).toBeNull()
  })

  test('supports native single (radio) and multiple (checkbox) selection, FormData, and uninitialized bind:checked', async () => {
    const opened: string[] = []
    const removed: string[] = []
    const target = document.createElement('div')
    document.body.append(target)

    const host = mount(AttachmentHost, {
      target,
      props: {
        onOpenAction: (id) => opened.push(id),
        onRemoveAction: (id) => removed.push(id),
      },
    })
    await tick()

    // Never render interactive buttons/links inside <label>, nor nested buttons, nor duplicate inputs.
    expect(target.querySelectorAll('label button, label a, button button, a button')).toHaveLength(0)

    const form = target.querySelector('[data-testid="selection-form"]') as HTMLFormElement
    const radios = [...target.querySelectorAll('[data-testid="single-group"] input[type="radio"]')] as HTMLInputElement[]
    const checkboxes = [...target.querySelectorAll('[data-testid="multi-group"] input[type="checkbox"]')] as HTMLInputElement[]

    expect(radios).toHaveLength(3)
    expect(checkboxes).toHaveLength(3)
    expect(checkboxes[2]!.disabled).toBe(true)

    const fdInitial = new FormData(form)
    expect(fdInitial.getAll('cover')).toEqual(['cov-1'])
    expect(fdInitial.getAll('docs')).toEqual(['doc-1'])

    // Switch single radio to second item: mutual exclusivity updates both Svelte state and FormData.
    radios[1]!.checked = true
    radios[1]!.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
    expect(host.getPickedSingle()).toBe('cov-2')
    expect(radios.map((r) => r.checked)).toEqual([false, true, false])
    expect(new FormData(form).getAll('cover')).toEqual(['cov-2'])

    // Toggle multiple checkboxes: adds doc-2 while preserving doc-1.
    checkboxes[1]!.checked = true
    checkboxes[1]!.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
    expect(host.getPickedMulti()).toEqual(['doc-1', 'doc-2'])
    expect(new FormData(form).getAll('docs')).toEqual(['doc-1', 'doc-2'])

    // Uninitialized boolean bind:checked works cleanly without props_invalid_value.
    expect(host.getSingleFlag()).toBeUndefined()
    const soloBox = target.querySelector('[data-testid="uninitialized-boolean"] input[type="checkbox"]') as HTMLInputElement
    soloBox.checked = true
    soloBox.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
    expect(host.getSingleFlag()).toBe(true)

    // Clicking sibling action button or open trigger never mutates selection or fires the other callback.
    const removeBeta = target.querySelector('button[aria-label="Удалить cover-beta.webp"]') as HTMLButtonElement
    removeBeta.click()
    await tick()
    expect(removed).toEqual(['cov-2'])
    expect(opened).toEqual([])
    expect(host.getPickedSingle()).toBe('cov-2')

    const openDoc1 = target.querySelector('button[aria-label="Открыть spec.pdf"]') as HTMLButtonElement
    openDoc1.click()
    await tick()
    expect(opened).toEqual(['doc-1'])
    expect(removed).toEqual(['cov-2'])
    expect(host.getPickedMulti()).toEqual(['doc-1', 'doc-2'])

    await unmount(host)
  })
})
