// Серверный POST-обработчик компонента `SeedForm` (`#hooks/component-form`).
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { auth, vaultPayloadOf } from '../../gateway.server.js'
import { instruction, seedOf, type LoginOutcome } from '../../index.js'
import { parseAuthStage, userAuthRoute } from '../../routes.js'
import { seedForm } from './form.js'

registerComponentForm({
  description: seedForm,
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
      case 'confirm': {
        const derived = await seedOf(String(values.seed ?? '').trim())
        const r = await u.verifySeed({
          seed: derived,
          nonce: String(values.nonce ?? ''),
          signature: values.signature ? String(values.signature) : undefined,
        })
        if (!r.ok) return gone(r.fact)
        commit()
        return { data: { step: 'confirmed', confirmed: true, sub: r.value.sub } }
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
    if (step === 'restore' || step === 'confirmed') return 'inline'
    const { next } = userAuthRoute.parse(event.url)
    if (step && step !== 'entry' && step !== 'done') {
      return userAuthRoute.href({ stage: parseAuthStage(step), next })
    }
    return next ?? '/'
  },
})
