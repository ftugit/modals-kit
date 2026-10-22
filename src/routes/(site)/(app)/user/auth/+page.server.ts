// Роут авторизации: ТОЛЬКО `authForm` (вход, регистрация, восстановление, выход).
// Редактирование и пост-регистрационное заполнение профиля живут на отдельном
// роуте `/user/profile` (и его встраиваемой форме `ProfileForm` через
// `componentFormsHandle` — роут авторизации профиль больше не обслуживает).
import { fail, redirect } from '@sveltejs/kit'
import { localPath } from '#lib/address/index.js'
import type { Actions, PageServerLoad } from './$types'
import type { RequestEvent } from '@sveltejs/kit'
import { createFormHandler, type ExecuteContext } from '#lib/form/server.js'
import { SECURITY_LAYERS } from '#lib/server/form-security.js'
import { auth, readVault, vaultPayloadOf } from '#content/user/gateway.js'
import { authForm } from '#content/user/forms.js'
import { createUserConfig, instruction, seedOf, type LoginOutcome } from '#content/user/index.js'
import { localStore } from '#lib/server/cache.js'

const config = createUserConfig(localStore.scope('user-config'))

/** Плоские значения `?stage=` старых ссылок — в куст `auth.*`. */
const LEGACY_STEP: Record<string, string> = {
  entry: 'auth.entry',
  register: 'auth.register',
  restore: 'auth.restore',
}

export const load: PageServerLoad = async (event) => {
  const url = event.url
  const next = localPath(url.searchParams.get('next'))
  const stepParam = url.searchParams.get('stage')
  let step = (stepParam && (LEGACY_STEP[stepParam] ?? stepParam)) || 'auth.entry'
  const user = await readVault(event.cookies).catch(() => null)

  // Прямой переход авторизованного на устаревший `?stage=profile` перенаправляем
  // на самостоятельный роут редактирования профиля `/user/profile`.
  if (step === 'profile') {
    if (user) {
      redirect(303, `/user/profile${next ? `?next=${encodeURIComponent(next)}` : ''}`)
    }
    step = 'auth.entry'
  }
  if (!user && (step === 'restrictions' || step === 'blocked')) step = 'auth.entry'

  let registerSeed: string | null = null
  if (step === 'auth.register') {
    const { generateKeyPair } = await import('#content/user/keys.js')
    registerSeed = (await generateKeyPair()).secret
  }
  const u = auth(event)
  const challenge = u.enabled ? await u.issueChallenge() : null

  return {
    enabled: u.enabled,
    challenge: challenge?.ok ? challenge.value : null,
    next,
    step,
    registerSeed,
    limits: {
      edge: await config.get('avatarEdge'),
      maxBytes: await config.get('avatarMaxBytes'),
      formats: await config.get('avatarFormats'),
      holdSeconds: await config.get('holdSeconds'),
    },
    user,
  }
}

const isJs = (request: Request): boolean => (request.headers.get('accept') ?? '').includes('application/json')

export const actions: Actions = {
  default: async (event) => {
    const u = auth(event)

    const authExecute = async ({ values, intent, commit, fail }: ExecuteContext) => {
      const gone = (fact: Parameters<typeof instruction>[0]) => fail(instruction(fact))
      const blockedStep = (fact: { args?: Record<string, string | number> }) => {
        const raw = fact.args?.until
        commit()
        return {
          data: {
            step: 'blocked',
            blocked: { reason: String(fact.args?.reason ?? 'не указана'), untilMs: typeof raw === 'number' && raw > 0 ? raw : null },
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
              restrictions: value.restrictions.map((b) => ({ scope: b.scope, reason: b.reason, untilMs: b.until ?? null })),
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
    }

    const handler = createFormHandler<unknown, RequestEvent>({
      description: authForm,
      order: SECURITY_LAYERS,
      execute: authExecute,
    })
    const { result, status } = await handler(event.request, 'action', event)
    if (result.ok) {
      const step = (result.data as { step?: string } | undefined)?.step
      if (!isJs(event.request) && step !== 'restore') {
        const next = localPath(new URL(event.request.url).searchParams.get('next'))
        if (step === 'profile') {
          redirect(303, `/user/profile?next=${encodeURIComponent(next ?? '/')}`)
        }
        if (step && step !== 'entry' && step !== 'done') {
          redirect(303, `/user/auth?stage=${step}${next ? `&next=${encodeURIComponent(next)}` : ''}`)
        }
        redirect(303, next ?? '/')
      }
      return { result }
    }
    return fail(status, { result })
  },
}
