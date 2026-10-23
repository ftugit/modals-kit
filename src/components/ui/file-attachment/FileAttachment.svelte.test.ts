// @vitest-environment happy-dom
import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import FileAttachmentHost from './FileAttachmentHost.test.svelte'

function makeFileList(items: File[]): FileList {
  const dt = new DataTransfer()
  for (const item of items) dt.items.add(item)
  return dt.files
}

function pickFiles(input: HTMLInputElement, items: File[]): void {
  input.files = makeFileList(items)
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('FileAttachment composition: FileInput + Attachment + DataTransfer + object URLs', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  test('mounts Attachment per File, preserves neighbour blob URLs on single remove, syncs bind:files and FormData', async () => {
    let seq = 0
    const created: string[] = []
    const revoked: string[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const u = `blob:fa-${++seq}`
      created.push(u)
      return u
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u: string) => {
      revoked.push(u)
    })

    const changeHistory: string[][] = []
    const target = document.createElement('div')
    document.body.append(target)

    const host = mount(FileAttachmentHost, {
      target,
      props: { onChangeFiles: (names) => changeHistory.push(names) },
    })
    await vi.dynamicImportSettled()
    await tick()

    const input = target.querySelector('input[type="file"]') as HTMLInputElement
    expect(host.getRef()).toBe(input)
    expect(target.querySelector('[data-file-list]')).toBeNull()

    const imgA = new File(['img-a'], 'alpha.png', { type: 'image/png' })
    const pdfB = new File(['pdf-b'], 'brief.pdf', { type: 'application/pdf' })
    const imgC = new File(['img-c'], 'gamma.png', { type: 'image/png' })

    pickFiles(input, [imgA, pdfB, imgC])
    await tick()

    expect(Array.from(host.getFiles() ?? [])).toEqual([imgA, pdfB, imgC])
    expect(target.querySelectorAll('[data-file-item]')).toHaveLength(3)
    // Only the two image files allocate object URLs; PDF uses inline SVG icon.
    expect(created).toEqual(['blob:fa-1', 'blob:fa-2'])
    expect(revoked).toEqual([])

    const form = target.querySelector('form') as HTMLFormElement
    expect(new FormData(form).getAll('uploads')).toEqual([imgA, pdfB, imgC])

    // Projecting upload progress/error onto a specific File updates its Attachment state.
    host.setMeta('brief.pdf', { state: 'uploading', progress: 55 })
    await tick()
    expect(target.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('55')

    // Removing alpha.png revokes ONLY blob:fa-1 while keeping gamma.png's blob:fa-2 alive without re-creating!
    const removeAlpha = target.querySelector('button[aria-label="Убрать файл: alpha.png"]') as HTMLButtonElement
    removeAlpha.click()
    await tick()

    expect(created).toEqual(['blob:fa-1', 'blob:fa-2'])
    expect(revoked).toEqual(['blob:fa-1'])
    expect(Array.from(host.getFiles() ?? [])).toEqual([pdfB, imgC])
    expect(new FormData(form).getAll('uploads')).toEqual([pdfB, imgC])
    expect(changeHistory.at(-1)).toEqual(['brief.pdf', 'gamma.png'])

    // Programmatic clear resets native input, hides list, and revokes remaining blob:fa-2.
    host.clearFiles()
    await tick()
    expect(input.files).toHaveLength(0)
    expect(target.querySelector('[data-file-list]')).toBeNull()
    expect(revoked).toEqual(['blob:fa-1', 'blob:fa-2'])

    await unmount(host)
    expect(host.getRef()).toBeNull()
    expect(host.getRefHistory().at(-1)).toBeNull()
  })

  test('supports removable={false} with custom actions snippet and tile layout', async () => {
    const inspected: string[] = []
    const target = document.createElement('div')
    document.body.append(target)

    const host = mount(FileAttachmentHost, {
      target,
      props: {
        removable: false,
        layout: 'tile',
        useCustomActions: true,
        onInspect: (name) => inspected.push(name),
      },
    })
    await tick()

    const input = target.querySelector('input[type="file"]') as HTMLInputElement
    const doc = new File(['hello'], 'readme.md', { type: 'text/markdown' })
    pickFiles(input, [doc])
    await tick()

    expect(target.querySelector('button[aria-label="Убрать файл: readme.md"]')).toBeNull()
    const infoBtn = target.querySelector('button[aria-label="Инфо readme.md"]') as HTMLButtonElement
    infoBtn.click()
    await tick()
    expect(inspected).toEqual(['readme.md'])
    expect(input.files).toHaveLength(1)

    const customRemove = target.querySelector('button[aria-label="Свой сброс readme.md"]') as HTMLButtonElement
    customRemove.click()
    await tick()
    expect(input.files).toHaveLength(0)
    expect(target.querySelector('[data-file-list]')).toBeNull()

    await unmount(host)
  })

  test('removes Attachment when single-file input mutates live FileList in place on value = ""', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:single-photo')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const target = document.createElement('div')
    document.body.append(target)

    const host = mount(FileAttachmentHost, { target })
    await tick()

    const input = target.querySelector('input[type="file"]') as HTMLInputElement
    const photo = new File(['jpeg'], 'avatar.jpg', { type: 'image/jpeg' })

    // Эмуляция Blink: один и тот же экземпляр FileList мутирует length 1 → 0 при `input.value = ''`.
    const backing: File[] = [photo]
    const liveList = {
      get length() {
        return backing.length
      },
      item(i: number) {
        return backing[i] ?? null
      },
      get 0() {
        return backing[0]
      },
      [Symbol.iterator]() {
        return backing[Symbol.iterator]()
      },
    } as unknown as FileList

    Object.defineProperty(input, 'files', {
      configurable: true,
      get: () => liveList,
    })
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => (backing.length ? 'C:\\fakepath\\avatar.jpg' : ''),
      set: (v: string) => {
        if (v === '') backing.length = 0
      },
    })

    input.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
    expect(target.querySelectorAll('[data-file-item]')).toHaveLength(1)

    const removeBtn = target.querySelector('button[aria-label="Убрать файл: avatar.jpg"]') as HTMLButtonElement
    removeBtn.click()
    await tick()

    expect(Object.is(input.files, liveList)).toBe(true)
    expect(input.files).toHaveLength(0)
    expect(target.querySelector('[data-file-list]')).toBeNull()

    await unmount(host)
  })
})
