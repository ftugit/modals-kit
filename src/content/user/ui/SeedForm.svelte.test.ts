// @vitest-environment happy-dom
import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SeedForm from './SeedForm.svelte'
import { SEED_FORM_ID, SEED_FORM_REV } from '../forms.js'

const VALID_SEED = 'A'.repeat(43)

async function settle(): Promise<void> {
  await tick()
  await Promise.resolve()
  await tick()
}

describe('SeedForm — режимы authorize=true (гость) и authorize=false (подтверждение владения)', () => {
  let origFetch: typeof globalThis.fetch

  beforeEach(() => {
    origFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = origFetch
    document.body.innerHTML = ''
  })

  it('authorize=true: рендерит форму гостю и закрывает её экраном guest-only авторизованному', async () => {
    const hostGuest = document.createElement('div')
    document.body.append(hostGuest)
    const guestApp = mount(SeedForm, {
      target: hostGuest,
      props: { view: 'entry', authorize: true, authorized: false, enabled: true },
    })
    await settle()
    expect(hostGuest.querySelector('#user-auth')).not.toBeNull()
    expect(hostGuest.querySelector('[data-acl-code]')).toBeNull()
    await unmount(guestApp)

    const hostUser = document.createElement('div')
    document.body.append(hostUser)
    const userApp = mount(SeedForm, {
      target: hostUser,
      props: { view: 'entry', authorize: true, authorized: true, enabled: true },
    })
    await settle()
    expect(hostUser.querySelector('#user-auth')).toBeNull()
    expect(hostUser.querySelector('[data-acl-code="guest_only"]')).not.toBeNull()
    await unmount(userApp)
  })

  it('authorize=false: закрывает форму гостю (auth-required), а авторизованному шлёт intent="confirm" и зовёт onConfirmed', async () => {
    const hostGuest = document.createElement('div')
    document.body.append(hostGuest)
    const guestApp = mount(SeedForm, {
      target: hostGuest,
      props: { authorize: false, authorized: false, enabled: true },
    })
    await settle()
    expect(hostGuest.querySelector('#user-seed-confirm')).toBeNull()
    expect(hostGuest.querySelector('[data-acl-code="auth_required"]')).not.toBeNull()
    await unmount(guestApp)

    const sentPayloads: FormData[] = []
    globalThis.fetch = vi.fn(async (_url, init) => {
      sentPayloads.push(init?.body as FormData)
      return new Response(
        JSON.stringify({
          data: {
            result: {
              v: 1,
              formId: SEED_FORM_ID,
              instance: 'seed-confirm-1',
              submissionId: 'sub-confirm-1',
              revision: SEED_FORM_REV,
              ok: true,
              status: 200,
              outcome: 'committed',
              errors: [],
              values: {},
              data: { step: 'confirmed', confirmed: true, sub: 'usr_1' },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    const onConfirmed = vi.fn()
    const hostUser = document.createElement('div')
    document.body.append(hostUser)
    const userApp = mount(SeedForm, {
      target: hostUser,
      props: {
        authorize: false,
        authorized: true,
        enabled: true,
        seed: VALID_SEED,
        confirmTitle: 'Удаление аккаунта',
        confirmLabel: 'Подтвердить удаление',
        onConfirmed,
      },
    })
    await settle()

    expect(hostUser.querySelector('#user-seed-confirm')).not.toBeNull()
    expect(hostUser.textContent).toContain('Удаление аккаунта')

    const btn = hostUser.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(btn.value).toBe('confirm')
    btn.click()

    await vi.waitFor(() => expect(sentPayloads.length).toBe(1))
    expect(sentPayloads[0]!.get('intent')).toBe('confirm')
    expect(sentPayloads[0]!.get('seed')).toBe(VALID_SEED)
    await vi.waitFor(() => expect(onConfirmed).toHaveBeenCalledWith({ sub: 'usr_1' }))

    await unmount(userApp)
  })
})
