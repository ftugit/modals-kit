// Серверная регистрация форм модуля пользователя (`authForm` и `profileForm`).
// Импортируется один раз в `src/hooks.server.ts`: все пользовательские
// компоненты (`AuthWidget` / `AuthForm`, `ProfileForm`, `MenuBody`, `vault`)
// работают через единый хук `#hooks/component-form` на любом маршруте без
// дублирования `actions` по страницам.
import { localPath } from '#lib/address/index.js'
import { registerComponentForm } from '#hooks/component-form/server.js'
import { auth, vaultPayloadOf } from './gateway.js'
import { authForm, profileForm } from './forms.js'
import { instruction, seedOf, type LoginOutcome } from './index.js'

registerComponentForm({
  description: authForm,
  execute: async ({ values, intent, commit, fail }, event) => {
    const u = auth(event)
    const gone = (fact: Parameters<typeof instruction>[0]) => fail(instruction(fact))
    const blockedStep = (fact: { args?: Record<string, string | number> }) => {
      const raw = fact.args?.until
      commit()
      return {
        data: {
          step: 'blocked',
          blocked: {
            reason: String(fact.args?.reason ?? 'не указана'),
            untilMs: typeof raw === 'number' && raw > 0 ? raw : null,
          },
        },
      }
    }
    const entered = async (value: LoginOutcome) => {
      const user = await vaultPayloadOf(value)
      if (value.restrictions.length > 0) {
        commit()
        return {
          data: {
            step: 'restrictions',
            user,
            restrictions: value.restrictions.map((b) => ({
              scope: b.scope,
              reason: b.reason,
              untilMs: b.until ?? null,
            })),
          },
        }
      }
      const prof = await u.profile()
      if (!prof.ok || prof.value === null) {
        commit()
        return { data: { step: 'profile', user } }
      }
      commit()
      return { data: { step: 'done', user } }
    }

    if (!u.enabled && intent !== 'logout') return gone({ code: 'auth.disabled' })
    switch (intent) {
      case 'login': {
        const derived = await seedOf(String(values.seed ?? '').trim())
        const r = await u.login({
          seed: derived,
          nonce: String(values.nonce ?? ''),
          signature: values.signature ? String(values.signature) : undefined,
        })
        if (!r.ok) {
          if (r.fact.code === 'auth.blocked') return blockedStep(r.fact)
          if (r.fact.code === 'auth.deleted') {
            commit()
            return { data: { step: 'restore' } }
          }
          return gone(r.fact)
        }
        return entered(r.value)
      }
      case 'restore': {
        const derived = await seedOf(String(values.seed ?? '').trim())
        const r = await u.restoreDeleted({
          seed: derived,
          nonce: String(values.nonce ?? ''),
          signature: values.signature ? String(values.signature) : undefined,
        })
        if (!r.ok) {
          if (r.fact.code === 'auth.blocked') return blockedStep(r.fact)
          return gone(r.fact)
        }
        return entered(r.value)
      }
      case 'accept': {
        commit()
        return { data: { step: 'done' } }
      }
      case 'logout': {
        await u.logout()
        commit()
        return { data: { step: 'entry' } }
      }
      case 'renew': {
        const r = await u.renew()
        if (!r.ok) return gone(r.fact)
        const user = await vaultPayloadOf(r.value)
        commit()
        return { data: user }
      }
      case 'challenge': {
        const r = await u.issueChallenge()
        if (!r.ok) return gone(r.fact)
        commit()
        return { data: r.value }
      }
      default:
        return gone({ code: 'auth.confirm' })
    }
  },
  redirectOnSuccess: (event, result) => {
    const step = (result.data as { step?: string } | undefined)?.step
    if (step === 'restore') return 'inline'
    const next = localPath(event.url.searchParams.get('next'))
    if (step && step !== 'entry' && step !== 'done') {
      return `/user/auth?stage=${step}${next ? `&next=${encodeURIComponent(next)}` : ''}`
    }
    return next ?? '/'
  },
})

registerComponentForm({
  description: profileForm,
  execute: async ({ values, intent, commit, fail }, event) => {
    const u = auth(event)
    if (!u.enabled) return fail(instruction({ code: 'auth.disabled' }))
    if (intent !== 'profile') return fail(instruction({ code: 'auth.confirm' }))

    const nickname = String(values.nickname ?? '').trim()
    const avatar = String(values.avatar ?? '')
    const r = await u.updateProfile({
      ...(nickname ? { nickname } : {}),
      ...(avatar ? { avatarUrl: avatar } : {}),
    })
    if (!r.ok) return fail(instruction(r.fact))

    commit()
    // Перевыпускаем куки сессии со свежим снимком ника/аватара, чтобы SSR и
    // клиентский vault сразу видели обновлённый профиль на любой странице.
    let user: unknown
    try {
      const renewed = await u.renew()
      if (renewed.ok) user = await vaultPayloadOf(renewed.value)
    } catch {
      /* профиль уже записан; обновится при штатном продлении */
    }
    return { data: { step: 'done', ...(user ? { user } : {}) } }
  },
  redirectOnSuccess: (event) => localPath(event.url.searchParams.get('next')) ?? '/',
})
