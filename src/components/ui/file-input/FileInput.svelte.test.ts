// @vitest-environment happy-dom
import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import FileInputHost from './FileInputHost.test.svelte'

function makeFileList(items: File[]): FileList {
  const dt = new DataTransfer()
  for (const item of items) dt.items.add(item)
  return dt.files
}

function selectFiles(input: HTMLInputElement, items: File[]): void {
  input.files = makeFileList(items)
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('FileInput pure primitive contract: bind:files, forwarded ref, and unbound reactive spread', () => {
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

  test('single and multiple file selections populate parent bind:files with identical File instances without creating blob URLs', async () => {
    const createUrlSpy = vi.spyOn(URL, 'createObjectURL')
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

    const a = new File(['alpha'], 'a.png', { type: 'image/png' })
    const b = new File(['beta-bytes'], 'b.csv', { type: 'text/csv' })
    selectFiles(input, [a, b])
    await tick()

    expect(Array.from(host.getFiles() ?? [])).toEqual([a, b])
    expect(host.getFiles()?.[0]).toBe(a)
    expect(host.getFiles()?.[1]).toBe(b)
    expect(seenCounts).toEqual([1, 2])
    expect(createUrlSpy).not.toHaveBeenCalled()
    expect(target.querySelector('[data-file-list]')).toBeNull()

    await unmount(host)
  })

  test('programmatic narrow via DataTransfer and clear via empty FileList or undefined sync native input.files', async () => {
    const target = document.createElement('div')
    document.body.append(target)
    const host = mount(FileInputHost, { target, props: { multiple: true } })
    await tick()

    const input = host.getRef()!
    const a = new File(['first'], 'first.txt', { type: 'text/plain' })
    const b = new File(['second'], 'second.txt', { type: 'text/plain' })

    selectFiles(input, [a, b])
    await tick()
    expect(input.files).toHaveLength(2)
    expect(host.getFiles()).toHaveLength(2)

    host.setFiles(makeFileList([b]))
    await tick()
    expect(input.files).toHaveLength(1)
    expect(input.files?.[0]).toBe(b)
    expect(host.getFiles()?.[0]).toBe(b)

    host.setFiles(makeFileList([]))
    await tick()
    expect(input.files).toHaveLength(0)
    expect(host.getFiles()).toHaveLength(0)

    selectFiles(input, [a])
    await tick()
    expect(input.files).toHaveLength(1)
    host.setFiles(undefined)
    await tick()
    expect(input.value).toBe('')
    expect(input.files).toHaveLength(0)
    expect(host.getFiles()).toBeUndefined()

    await unmount(host)
  })

  test('unbound reactive spread mode preserves native input.files across parent attribute re-renders', async () => {
    const a = new File(['one'], 'one.pdf', { type: 'application/pdf' })
    const b = new File(['two'], 'two.pdf', { type: 'application/pdf' })

    const multiTarget = document.createElement('div')
    document.body.append(multiTarget)
    const multiHost = mount(FileInputHost, {
      target: multiTarget,
      props: { unbound: true, multiple: true },
    })
    await tick()

    const multiInput = multiHost.getRef()!
    selectFiles(multiInput, [a, b])
    await tick()
    expect(multiHost.getValue()).toEqual([a, b])
    expect(multiInput.files).toHaveLength(2)

    await unmount(multiHost)
  })
})
