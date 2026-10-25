// @vitest-environment happy-dom
import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { defineForm, field, v } from '#lib/form/index.js'
import { bind, createConfig, type BoundConfig, type FieldComponent } from '#lib/form/svelte/index.js'
import FileFieldHost from './FileFieldHost.test.svelte'

function withRoot<T>(fn: () => T): { value: T; dispose: () => void } {
  let value!: T
  const dispose = $effect.root(() => {
    value = fn()
  })
  return { value, dispose }
}

const Stub = (() => {}) as unknown as FieldComponent
const cfg: BoundConfig = createConfig({ resolve: () => Stub })

const desc = defineForm({
  id: 'file-field-migration-demo',
  revision: 1,
  actions: [{ id: 'submit', validate: 'full' }],
  fields: {
    cover: field.file({
      label: 'Обложка',
      variant: 'preview',
      validate: [v.accept(['image/png']), v.maxSize(10)],
    }),
    docs: field.files({
      label: 'Документы',
      validate: [v.maxCount(3), v.maxSize(1024 * 1024)],
    }),
    gallery: field.files({
      label: 'Галерея',
      variant: 'preview',
      validate: [v.accept(['image/png']), v.maxCount(2), v.maxSize(1024 * 1024)],
    }),
  },
})

function pickFiles(input: HTMLInputElement, items: File[]): void {
  const dt = new DataTransfer()
  for (const item of items) dt.items.add(item)
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('FileField: pure FileInput vs FileAttachment (variant: "preview")', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  test('routes variant="preview" through FileAttachment, revalidates on remove, and keeps default fields on FileInput', async () => {
    let seq = 0
    const created: string[] = []
    const revoked: string[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const u = `blob:ff-${++seq}`
      created.push(u)
      return u
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u: string) => {
      revoked.push(u)
    })

    const root = withRoot(() => bind(cfg, desc))
    const target = document.createElement('div')
    document.body.append(target)
    const comp = mount(FileFieldHost, { target, props: { bound: root.value } })
    await vi.dynamicImportSettled()
    await tick()

    // Default `docs` uses plain FileInput (no [data-slot="file-attachment"], no preview cards)
    const docsField = target.querySelector('[data-field="docs"]')!
    expect(docsField.querySelector('[data-slot="file-attachment"]')).toBeNull()
    const docsInput = docsField.querySelector('input[type="file"]') as HTMLInputElement
    const rawDoc = new File(['abc'], 'contract.pdf', { type: 'application/pdf' })
    pickFiles(docsInput, [rawDoc])
    await tick()
    expect(docsField.querySelector('[data-file-list]')).toBeNull()
    expect(root.value.f.docs.value).toEqual([rawDoc])

    // Single `cover` (`variant: 'preview'`) validates maxSize immediately on pick and clears error on remove
    const coverField = target.querySelector('[data-field="cover"]')!
    expect(coverField.querySelector('[data-slot="file-attachment"]')).not.toBeNull()
    const coverInput = coverField.querySelector('input[type="file"]') as HTMLInputElement
    const hugePng = new File(['0123456789ABCDEF'], 'huge.png', { type: 'image/png' })
    pickFiles(coverInput, [hugePng])
    await tick()

    expect(root.value.f.cover.value).toBe(hugePng)
    coverField.querySelector('input[type="file"]')!.dispatchEvent(new Event('blur'))
    await tick()
    expect(root.value.f.cover.errors.length).toBeGreaterThan(0)
    expect(coverField.querySelectorAll('[data-file-item]')).toHaveLength(1)
    expect(created).toEqual(['blob:ff-1'])

    const removeCover = coverField.querySelector('button[aria-label="Убрать файл: huge.png"]') as HTMLButtonElement
    removeCover.click()
    await tick()

    expect(root.value.f.cover.value).toBeNull()
    expect(root.value.f.cover.errors).toEqual([])
    expect(coverField.querySelector('[data-file-list]')).toBeNull()
    expect(revoked).toEqual(['blob:ff-1'])

    // Multiple `gallery` (`variant: 'preview'`) narrows File[] via DataTransfer when removing excess file
    const galleryField = target.querySelector('[data-field="gallery"]')!
    const galleryInput = galleryField.querySelector('input[type="file"]') as HTMLInputElement
    const p1 = new File(['1'], 'one.png', { type: 'image/png' })
    const p2 = new File(['2'], 'two.png', { type: 'image/png' })
    const p3 = new File(['3'], 'three.png', { type: 'image/png' })
    pickFiles(galleryInput, [p1, p2, p3])
    galleryInput.dispatchEvent(new Event('blur'))
    await tick()

    expect(root.value.f.gallery.value).toEqual([p1, p2, p3])
    expect(root.value.f.gallery.errors.length).toBeGreaterThan(0)

    const removeFirst = galleryField.querySelector('button[aria-label="Убрать файл: one.png"]') as HTMLButtonElement
    removeFirst.click()
    await tick()

    expect(root.value.f.gallery.value).toEqual([p2, p3])
    expect(root.value.f.gallery.errors).toEqual([])

    await unmount(comp)
    root.dispose()
  })
})
