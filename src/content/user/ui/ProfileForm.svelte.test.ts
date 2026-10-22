// @vitest-environment happy-dom
import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AvatarLimits, AvatarOutcome } from '../avatar.js'

const prepareAvatarMock = vi.fn<
  (file: File, limits: AvatarLimits, opts?: { signal?: AbortSignal }) => Promise<AvatarOutcome>
>()

vi.mock('../avatar.js', () => ({
  prepareAvatar: (file: File, limits: AvatarLimits, opts?: { signal?: AbortSignal }) =>
    prepareAvatarMock(file, limits, opts),
}))

import ProfileForm from './ProfileForm.svelte'

const LIMITS: AvatarLimits = { edge: 200, maxBytes: 20_480, formats: ['jpeg', 'png', 'webp'] }

function assignFile(input: HTMLInputElement, file: File): void {
  const dt = new DataTransfer()
  dt.items.add(file)
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

async function settle(): Promise<void> {
  await tick()
  await Promise.resolve()
  await tick()
}

describe('ProfileForm — компактный Attachment аватара и ожидание конвертации при submit', () => {
  const createdUrls: string[] = []
  let origCreate: typeof URL.createObjectURL
  let origRevoke: typeof URL.revokeObjectURL
  let origFetch: typeof globalThis.fetch

  beforeEach(() => {
    prepareAvatarMock.mockReset()
    origCreate = URL.createObjectURL
    origRevoke = URL.revokeObjectURL
    origFetch = globalThis.fetch
    let seq = 0
    URL.createObjectURL = vi.fn(() => {
      const u = `blob:avatar-${++seq}`
      createdUrls.push(u)
      return u
    })
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    URL.createObjectURL = origCreate
    URL.revokeObjectURL = origRevoke
    globalThis.fetch = origFetch
    createdUrls.length = 0
    document.body.innerHTML = ''
  })

  it('рендерит только компактное поле и превью без имени файла, веса и прогресс-бара, и удерживает submit до конца конвертации', async () => {
    let resolveConvert!: (v: AvatarOutcome) => void
    prepareAvatarMock.mockImplementation(
      () =>
        new Promise<AvatarOutcome>((resolve) => {
          resolveConvert = resolve
        }),
    )

    const sentPayloads: FormData[] = []
    globalThis.fetch = vi.fn(async (_url, init) => {
      sentPayloads.push(init?.body as FormData)
      return new Response(
        JSON.stringify({
          data: {
            result: {
              v: 1,
              formId: 'user-profile',
              instance: 'user-profile:new',
              submissionId: 'sub-1',
              revision: 1,
              ok: true,
              status: 200,
              outcome: 'committed',
              errors: [],
              values: {},
              data: { step: 'done' },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    const onDone = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const app = mount(ProfileForm, {
      target: host,
      props: {
        action: '/user/auth',
        limits: LIMITS,
        initial: { nickname: 'Neo', avatarUrl: 'https://example.com/old.jpg' },
        doneHref: '/',
        onDone,
      },
    })
    await settle()

    // До выбора нового файла показывается компактный Attachment текущего аватара без имени/веса
    const initialCard = host.querySelector('[data-field="avatar"] [data-slot="attachment"]')!
    expect(initialCard.getAttribute('data-layout')).toBe('tile')
    expect(initialCard.getAttribute('data-size')).toBe('sm')
    expect(initialCard.querySelector('[data-slot="attachment-title"]')).toBeNull()
    expect(initialCard.querySelector('[data-slot="attachment-description"]')).toBeNull()
    expect(initialCard.querySelector('[data-slot="attachment-progress"]')).toBeNull()
    expect(initialCard.querySelector('img')?.getAttribute('src')).toBe('https://example.com/old.jpg')

    // Выбираем новый файл — превью переключается на blob, без имени/веса и без прогресс-бара
    const fileInput = host.querySelector('[data-field="avatar"] input[type="file"]') as HTMLInputElement
    assignFile(fileInput, new File(['raw-image'], 'photo.png', { type: 'image/png' }))
    await settle()

    const cards = host.querySelectorAll('[data-field="avatar"] [data-slot="attachment"]')
    expect(cards.length).toBe(1)
    expect(cards[0]!.querySelector('img')?.getAttribute('src')).toBe('blob:avatar-1')
    expect(cards[0]!.querySelector('[data-slot="attachment-title"]')).toBeNull()
    expect(cards[0]!.querySelector('[data-slot="attachment-description"]')).toBeNull()
    expect(cards[0]!.querySelector('[data-slot="attachment-progress"]')).toBeNull()

    // Отправляем форму ДО завершения prepareAvatar — запрос удерживается в очереди f.pending
    const submitBtn = host.querySelector('button[type="submit"]') as HTMLButtonElement
    submitBtn.click()
    await settle()
    expect(sentPayloads.length).toBe(0)

    // Завершаем конвертацию — форма перечитывает DOM и отправляет свежесконвертированный dataURL
    resolveConvert({
      ok: true,
      dataUrl: 'data:image/jpeg;base64,FRESH',
      bytes: 512,
      quality: 0.9,
      encoder: 'mozjpeg',
    })
    await vi.waitFor(() => expect(sentPayloads.length).toBe(1))
    expect(sentPayloads[0]!.get('avatar')).toBe('data:image/jpeg;base64,FRESH')
    expect(onDone).toHaveBeenCalledTimes(1)

    await unmount(app)
  })

  it('при отказе конвертации очищает выбор, показывает ошибку у поля и блокирует отправку', async () => {
    prepareAvatarMock.mockResolvedValue({ ok: false, code: 'profile.avatar-format' })
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch

    const host = document.createElement('div')
    document.body.append(host)
    const app = mount(ProfileForm, {
      target: host,
      props: {
        action: '/user/auth',
        limits: LIMITS,
        initial: null,
        doneHref: '/',
        onDone: () => {},
      },
    })
    await settle()

    const fileInput = host.querySelector('[data-field="avatar"] input[type="file"]') as HTMLInputElement
    assignFile(fileInput, new File(['broken'], 'bad.png', { type: 'image/png' }))
    await vi.waitFor(() =>
      expect(host.querySelector('[data-field="avatar"] [role="alert"]')?.textContent).toContain(
        'формат не из разрешённых',
      ),
    )
    expect(host.querySelectorAll('[data-field="avatar"] [data-slot="attachment"]').length).toBe(0)

    const submitBtn = host.querySelector('button[type="submit"]') as HTMLButtonElement
    submitBtn.click()
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()

    await unmount(app)
  })
})
