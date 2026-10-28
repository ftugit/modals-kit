// @vitest-environment happy-dom
import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProfileForm from './ProfileForm.svelte'
import { defaults } from '../../config.js'
import { createUserChecks } from '../../checks.js'
import { specAvatar } from '../../spec-avatar.js'
import { IMAGE_RAW_MAX_BYTES, profileForm } from './form.js'

// Кнопка удаления — механика модальной ссылки: без ModalHost её заменяет
// заглушка с тем же видимым итогом (`href` пары удаления).
vi.mock('#hooks/links/index.js', () => ({
  useModalLink: () => (name: string, params: { id?: string }) => ({
    href: name === 'user.profile.delete' ? `/user/${params.id}/delete` : '/',
    'data-modal-link': '',
  }),
}))

describe('профиль: картинка — обычное поле файла', () => {
  it('тип `file`, приёмные типы и предел файла 20 КБ — правила поля', () => {
    const f = profileForm.byName['photo']!
    expect(f.kind).toBe('file')
    expect(f.multiple).toBeUndefined()
    const kinds = profileForm.constraintsOf('photo').map((c) => c.kind)
    expect(kinds).toContain('accept')
    expect(kinds).toContain('maxSize')
    // предел — вес готового кадра: сервер картинку не сжимает
    expect(IMAGE_RAW_MAX_BYTES).toBe(20_480)
    expect(profileForm.constraintsOf('photo')).toContainEqual({
      kind: 'maxSize',
      bytes: specAvatar.maxBytes,
    })
  })

  it('соответствие спеке проверяет `avatar-spec`: сервер не конвертирует', () => {
    const checks = createUserChecks({ nicknameForbidden: defaults.nicknameForbidden })
    expect(checks.has('avatar-spec')).toBe(true)
    const names = profileForm.byName['photo']!.validators
      .map((ref) => {
        try { return (profileForm.registry.validators.resolve(ref) as { asyncCheck?: { name: string } }).asyncCheck?.name }
        catch { return undefined }
      })
      .filter(Boolean)
    expect(names).toContain('avatar-spec')
  })

  it('содержимое судит общее правило `image` (асинхронная проверка поля)', () => {
    const d = profileForm
    const asyncNames = d.byName['photo']!.validators
      .map((ref) => {
        try { return (d.registry.validators.resolve(ref) as { asyncCheck?: { name: string } }).asyncCheck?.name }
        catch { return undefined }
      })
      .filter(Boolean)
    expect(asyncNames).toContain('image')
  })

  it('спека — единственное место параметров картинки; в конфиге их нет', () => {
    expect(specAvatar).toEqual({ width: 200, height: 200, maxBytes: 20_480, format: 'jpeg' })
    expect(Object.keys(defaults).filter((k) => k.startsWith('avatar'))).toEqual([])
  })
})

describe('профиль: текущий аватар в превью поля', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  const mountForm = async (avatarUrl: string | null) => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pf')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const target = document.createElement('div')
    document.body.append(target)
    const app = mount(ProfileForm, {
      target,
      props: {
        authorized: true,
        enabled: true,
        initial: { nickname: 'nick', avatarUrl } as never,
      },
    })
    await tick()
    return { target, app }
  }

  const pick = async (input: HTMLInputElement, file: File) => {
    const dt = new DataTransfer()
    dt.items.add(file)
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  it('сохранённый аватар показан карточкой превью, пока не выбран файл', async () => {
    const { target, app } = await mountForm('data:image/jpeg;base64,AAA')
    const cards = target.querySelectorAll('[data-existing-item]')
    expect(cards).toHaveLength(1)
    expect(cards[0]?.querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,AAA')

    const input = target.querySelector('input[type="file"]') as HTMLInputElement
    await pick(input, new File(['png'], 'photo.png', { type: 'image/png' }))

    // выбранный файл занял место аватара в том же превью — карточка одна
    await vi.waitFor(() => expect(target.querySelectorAll('[data-file-item]')).toHaveLength(1))
    expect(target.querySelectorAll('[data-existing-item]')).toHaveLength(0)
    await unmount(app)
  })

  it('без сохранённого аватара превью пустое', async () => {
    const { target, app } = await mountForm(null)
    expect(target.querySelectorAll('[data-existing-item]')).toHaveLength(0)
    await unmount(app)
  })

  it('кнопка у карточки снимает аватар: карточка уходит, `remove_photo` отмечен', async () => {
    const { target, app } = await mountForm('data:image/jpeg;base64,AAA')
    const drop = target.querySelector(
      'button[aria-label="Убрать файл: Текущий аватар"]',
    ) as HTMLButtonElement
    expect(drop).not.toBeNull()

    drop.click()
    await tick()

    expect(target.querySelectorAll('[data-existing-item]')).toHaveLength(0)
    const flagged = target.querySelector('input[name="remove_photo"]') as HTMLInputElement
    expect(flagged.checked).toBe(true)
    await unmount(app)
  })
})

describe('профиль: та же форма для любого пользователя', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  const mountFor = async (props: Record<string, unknown>) => {
    const target = document.createElement('div')
    document.body.append(target)
    const app = mount(ProfileForm, { target, props: { authorized: true, enabled: true, ...props } })
    await tick()
    return { target, app }
  }

  it('`subject` уезжает скрытым полем, а значения — из `initial`, не из своего `vault`', async () => {
    const { target, app } = await mountFor({
      subject: 'acc-42',
      initial: { nickname: 'чужой', avatarUrl: null },
    })
    const subject = target.querySelector('input[name="subject"]') as HTMLInputElement
    expect(subject?.value).toBe('acc-42')
    const nickname = target.querySelector('input[name="nickname"]') as HTMLInputElement
    expect(nickname?.value).toBe('чужой')
    await unmount(app)
  })

  it('без `subject` поле пустое — правится свой профиль', async () => {
    const { target, app } = await mountFor({ initial: { nickname: 'свой', avatarUrl: null } })
    const subject = target.querySelector('input[name="subject"]') as HTMLInputElement
    expect(subject?.value ?? '').toBe('')
    await unmount(app)
  })
})

describe('профиль: кнопка удаления в редактировании (этап 7)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('без deleteId кнопки нет; с ним — ссылка на пару удаления цели', async () => {
    const target = document.createElement('div')
    document.body.append(target)
    const app = mount(ProfileForm, {
      target,
      props: { authorized: true, enabled: true, subject: 'acc-7', deleteId: 'acc-7' },
    })
    await tick()
    const link = target.querySelector('[data-testid="profile-delete-link"]')
    expect(link?.getAttribute('href')).toBe('/user/acc-7/delete')
    await unmount(app)
  })
})
