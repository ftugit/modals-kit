// @vitest-environment happy-dom
import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SeedForm from './SeedForm.svelte'
import { SEED_FORM_ID, SEED_FORM_REV } from './form.js'

const VALID_SEED = 'A'.repeat(43)

async function settle(): Promise<void> {
  await tick()
  await Promise.resolve()
  await tick()
}

describe('SeedForm — режимы authorize=true (гость) и authorize=false (проверка без сессии)', () => {
  let origFetch: typeof globalThis.fetch

  beforeEach(() => {
    origFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = origFetch
    document.body.innerHTML = ''
  })

  it('authorize=true: рендерит форму гостю и закрывает её экраном guest_only авторизованному', async () => {
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

  it('authorize=false: доступна и гостю, и авторизованному, шлёт intent="confirm" без смены токена и зовёт onConfirmed', async () => {
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
              submissionId: `sub-${sentPayloads.length}`,
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

    // 1. Гость проверяет seed без авторизации (например, перед следующим шагом)
    const onGuestConfirmed = vi.fn()
    const hostGuest = document.createElement('div')
    document.body.append(hostGuest)
    const guestApp = mount(SeedForm, {
      target: hostGuest,
      props: {
        authorize: false,
        authorized: false,
        enabled: true,
        seed: VALID_SEED,
        onConfirmed: onGuestConfirmed,
      },
    })
    await settle()
    expect(hostGuest.querySelector('#user-seed-confirm')).not.toBeNull()
    ;(hostGuest.querySelector('button[type="submit"]') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(sentPayloads.length).toBe(1))
    expect(sentPayloads[0]!.get('intent')).toBe('confirm')
    await vi.waitFor(() => expect(onGuestConfirmed).toHaveBeenCalledWith({ sub: 'usr_1' }))
    await unmount(guestApp)

    // 2. Авторизованный пользователь проверяет seed без смены своего токена
    const onUserConfirmed = vi.fn()
    const hostUser = document.createElement('div')
    document.body.append(hostUser)
    const userApp = mount(SeedForm, {
      target: hostUser,
      props: {
        authorize: false,
        authorized: true,
        enabled: true,
        seed: VALID_SEED,
        confirmTitle: 'Подтверждение операции',
        onConfirmed: onUserConfirmed,
      },
    })
    await settle()
    expect(hostUser.querySelector('#user-seed-confirm')).not.toBeNull()
    expect(hostUser.textContent).toContain('Подтверждение операции')
    ;(hostUser.querySelector('button[type="submit"]') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(sentPayloads.length).toBe(2))
    expect(sentPayloads[1]!.get('intent')).toBe('confirm')
    await vi.waitFor(() => expect(onUserConfirmed).toHaveBeenCalledWith({ sub: 'usr_1' }))
    await unmount(userApp)
  })
})
