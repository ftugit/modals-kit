// @vitest-environment happy-dom
import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import FileInputHost from './FileInputHost.test.svelte'

vi.mock('compressorjs', () => ({
  default: class MockCompressor {
    constructor(file: File, opts: { success?: (blob: Blob) => void; error?: (err: Error) => void }) {
      queueMicrotask(() => {
        if (file.name.includes('corrupt')) opts.error?.(new Error('decode failed'))
        else opts.success?.(new Blob(['thumb'], { type: 'image/webp' }))
      })
    }
  },
}))

function makeFileList(items: File[]): FileList {
  const dt = new DataTransfer()
  for (const item of items) dt.items.add(item)
  return dt.files
}

function selectFiles(input: HTMLInputElement, items: File[]): void {
  input.files = makeFileList(items)
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

const settle = async () => {
  await tick()
  await new Promise((r) => setTimeout(r, 15))
  await tick()
}

describe('FileInput contract: bind:files, forwarded ref, legacy preview, and unbound reactive spread', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  test('ref exposes the real HTMLInputElement and clears to null on unmount', async () => {
    const target = document.createElement('div')
    document.body.append(target)
    const host = mount(FileInputHost, { target })
    await tick()

    const domInput = target.querySelector('input[type="file"]')
    expect(domInput).toBeInstanceOf(HTMLInputElement)
    expect(host.getRef()).toBe(domInput)
    expect(host.getRef()?.files).toHaveLength(0)

    await unmount(host)
    expect(host.getRef()).toBeNull()
    expect(host.getRefHistory().at(-1)).toBeNull()
  })

  test('single and multiple file selections populate parent bind:files with identical File instances', async () => {
    const seenCounts: number[] = []
    const target = document.createElement('div')
    document.body.append(target)
    const host = mount(FileInputHost, {
      target,
      props: {
        multiple: true,
        onPicked: (seenInChange, fromTarget) => {
          expect(Array.from(seenInChange ?? [])).toEqual(Array.from(fromTarget ?? []))
          expect(seenInChange?.[0]).toBe(fromTarget?.[0])
          seenCounts.push(seenInChange?.length ?? -1)
        },
      },
    })
    await tick()

    const input = host.getRef()!
    const one = new File(['hello'], 'note.txt', { type: 'text/plain' })
    selectFiles(input, [one])
    await tick()

    expect(host.getFiles()).toHaveLength(1)
    expect(host.getFiles()?.[0]).toBe(one)
    expect(seenCounts).toEqual([1])

    const a = new File(['alpha'], 'a.pdf', { type: 'application/pdf' })
    const b = new File(['beta-bytes'], 'b.csv', { type: 'text/csv' })
    selectFiles(input, [a, b])
    await tick()

    expect(Array.from(host.getFiles() ?? [])).toEqual([a, b])
    expect(host.getFiles()?.[0]).toBe(a)
    expect(host.getFiles()?.[1]).toBe(b)
    expect(seenCounts).toEqual([1, 2])

    await unmount(host)
  })

  test('programmatic narrow and clear on bind:files update both native input.files and parent binding', async () => {
    const target = document.createElement('div')
    document.body.append(target)
    const host = mount(FileInputHost, { target, props: { multiple: true, preview: true } })
    await tick()

    const input = host.getRef()!
    const a = new File(['first'], 'first.txt', { type: 'text/plain' })
    const b = new File(['second'], 'second.txt', { type: 'text/plain' })

    selectFiles(input, [a, b])
    await settle()
    expect(input.files).toHaveLength(2)
    expect(host.getFiles()).toHaveLength(2)
    expect(target.querySelectorAll('[data-file-item]')).toHaveLength(2)

    // Narrow selection via DataTransfer (remove `first.txt`, keep `second.txt`)
    host.setFiles(makeFileList([b]))
    await settle()
    expect(input.files).toHaveLength(1)
    expect(input.files?.[0]).toBe(b)
    expect(host.getFiles()).toHaveLength(1)
    expect(host.getFiles()?.[0]).toBe(b)
    expect(target.querySelectorAll('[data-file-item]')).toHaveLength(1)
    expect(target.textContent).toContain('second.txt')
    expect(target.textContent).not.toContain('first.txt')

    // Clear via empty DataTransfer().files
    host.setFiles(makeFileList([]))
    await settle()
    expect(input.files).toHaveLength(0)
    expect(host.getFiles()).toHaveLength(0)
    expect(target.querySelector('[data-file-list]')).toBeNull()

    // Re-pick then clear via idiomatic Svelte `files = undefined`
    selectFiles(input, [a])
    await settle()
    expect(input.files).toHaveLength(1)
    host.setFiles(undefined)
    await settle()
    expect(input.value).toBe('')
    expect(input.files).toHaveLength(0)
    expect(host.getFiles()).toBeUndefined()
    expect(target.querySelector('[data-file-list]')).toBeNull()

    await unmount(host)
  })

  test('legacy preview renders thumbnails/icons, removes single or last item, and syncs native + parent bind:files', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL')
    const changes: number[] = []
    const target = document.createElement('div')
    document.body.append(target)
    const host = mount(FileInputHost, {
      target,
      props: {
        multiple: true,
        preview: true,
        onPicked: (seen) => changes.push(seen?.length ?? 0),
      },
    })
    await tick()

    const input = host.getRef()!
    const img = new File(['raw-png'], 'photo.png', { type: 'image/png' })
    const doc = new File([new Uint8Array(2048)], 'spec.pdf', { type: 'application/pdf' })

    selectFiles(input, [img, doc])
    await settle()

    const items = target.querySelectorAll('[data-file-item]')
    expect(items).toHaveLength(2)
    expect(items[0]?.querySelector('img[src^="blob:"]')).not.toBeNull()
    expect(items[1]?.querySelector('svg')).not.toBeNull()
    expect(items[1]?.textContent).toContain('2 КиБ')

    // Remove first item via legacy preview button -> keeps second item in both DOM input.files and bind:files
    items[0]!.querySelector('button')!.click()
    await settle()

    expect(input.files).toHaveLength(1)
    expect(input.files?.[0]).toBe(doc)
    expect(host.getFiles()).toHaveLength(1)
    expect(host.getFiles()?.[0]).toBe(doc)
    expect(target.querySelectorAll('[data-file-item]')).toHaveLength(1)
    expect(revokeSpy).toHaveBeenCalled()

    // Remove last remaining item -> clears input.files and bind:files completely
    target.querySelector<HTMLButtonElement>('[data-file-item] button')!.click()
    await settle()

    expect(input.files).toHaveLength(0)
    expect(host.getFiles()).toHaveLength(0)
    expect(target.querySelector('[data-file-list]')).toBeNull()
    expect(changes).toEqual([2, 1, 0])

    await unmount(host)
  })

  test('unbound reactive spread mode (FileField pattern) preserves single File | null and multiple File[] through preview remove', async () => {
    const a = new File(['one'], 'one.pdf', { type: 'application/pdf' })
    const b = new File(['two'], 'two.pdf', { type: 'application/pdf' })

    // Single file mode (`File | null`) with reactive `{...attrs}` spread and `preview: true`
    const singleTarget = document.createElement('div')
    document.body.append(singleTarget)
    const singleHost = mount(FileInputHost, { target: singleTarget, props: { unbound: true, preview: true } })
    await tick()

    const singleInput = singleHost.getRef()!
    selectFiles(singleInput, [a])
    await settle()
    expect(singleHost.getValue()).toBe(a)
    expect(singleTarget.querySelectorAll('[data-file-item]')).toHaveLength(1)

    singleTarget.querySelector<HTMLButtonElement>('[data-file-item] button')!.click()
    await settle()
    expect(singleHost.getValue()).toBeNull()
    expect(singleInput.files).toHaveLength(0)
    expect(singleTarget.querySelector('[data-file-list]')).toBeNull()
    await unmount(singleHost)

    // Multiple file mode (`File[]`) with reactive `{...attrs}` spread and `preview: true`
    const multiTarget = document.createElement('div')
    document.body.append(multiTarget)
    const multiHost = mount(FileInputHost, {
      target: multiTarget,
      props: { unbound: true, multiple: true, preview: true },
    })
    await tick()

    const multiInput = multiHost.getRef()!
    selectFiles(multiInput, [a, b])
    await settle()
    expect(multiHost.getValue()).toEqual([a, b])
    expect(multiTarget.querySelectorAll('[data-file-item]')).toHaveLength(2)

    multiTarget.querySelector<HTMLButtonElement>('[data-file-item] button')!.click()
    await settle()
    expect(multiHost.getValue()).toEqual([b])
    expect(multiTarget.querySelectorAll('[data-file-item]')).toHaveLength(1)

    multiTarget.querySelector<HTMLButtonElement>('[data-file-item] button')!.click()
    await settle()
    expect(multiHost.getValue()).toEqual([])
    expect(multiInput.files).toHaveLength(0)
    await unmount(multiHost)
  })
})
