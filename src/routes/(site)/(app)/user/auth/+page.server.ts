// Роут авторизации: ОДНА форма (`authForm`, шаги различает интент), приём —
// через слои `lib/form` (метод, origin, тело, имена, конверт), бизнес — голые
// функции `auth.ts`. REST нет, по решению владельца.
//
// Шаги: маркер — в адресе страницы (`?step=`), поля живут в DOM. С JS экшен
// отвечает данными (транспорт виджета шлёт accept: application/json); без JS
// успех входа — redirect(303) на адрес следующего шага или на `next`.
import { fail, redirect } from '@sveltejs/kit'
import { localPath } from '#lib/address/index.js'
import type { Actions, PageServerLoad } from './$types'
import type { RequestEvent } from '@sveltejs/kit'
import { createFormHandler } from '#lib/form/server.js'
import { SECURITY_LAYERS } from '#lib/server/form-security.js'
import { auth, readVault, vaultPayloadOf } from '#content/user/gateway.js'
import { authForm } from '#content/user/forms.js'
import { createUserConfig, instruction, seedOf } from '#content/user/index.js'
import { localStore } from '#lib/server/cache.js'

const config = createUserConfig(localStore.scope('user-config'))

export const load: PageServerLoad = async (event) => {
  const url = new URL(event.request.url)
  const stepParam = url.searchParams.get('step')
  let registerSeed: string | null = null
  if (stepParam === 'register') {
    // без JS seed делает сервер (решение владельца); секрет едет в поле страницы
    const { generateKeyPair } = await import('#content/user/keys.js')
    registerSeed = (await generateKeyPair()).secret
  }
  const u = auth(event)
  // вход выключен — challenge не выдаётся, форма скрыта (сообщение в виджете)
  const challenge = u.enabled ? await u.issueChallenge() : null
  return {
    enabled: u.enabled,
    challenge: challenge?.ok ? challenge.value : null,
    next: localPath(url.searchParams.get('next')),
    step: (stepParam ?? 'entry') as 'entry' | 'register' | 'restore' | 'profile' | 'restrictions',
    registerSeed,
    limits: {
      edge: await config.get('avatarEdge'),
      maxBytes: await config.get('avatarMaxBytes'),
      formats: await config.get('avatarFormats'),
      holdSeconds: await config.get('holdSeconds'),
    },
    user: await readVault(event.cookies).catch(() => null),
  }
}

const isJs = (request: Request): boolean => (request.headers.get('accept') ?? '').includes('application/json')

export const actions: Actions = {
  default: async (event) => {
    // Замыкание event: execute нужны куки (токены ставит фасад). Обработчик
    // собирается на запрос — это объект-обёртка, не состояние.
    const u = auth(event)
    const handler = createFormHandler<unknown, RequestEvent>({
      description: authForm,
      order: SECURITY_LAYERS,
      async execute({ values, intent, commit, fail }) {
        const gone = (fact: Parameters<typeof instruction>[0]) => fail(instruction(fact))
        // вход выключен: экшены честно отказывают (кроме выхода — куки чистить можно)
        if (!u.enabled && intent !== 'logout') return gone({ code: 'auth.disabled' })
        switch (intent) {
          case 'login': {
            const secret = String(values.seed ?? '').trim()
            if (secret.length < 43 || secret.length > 44) return gone({ code: 'auth.signature' })
            const derived = await seedOf(secret)
            const r = await u.login({
              seed: derived,
              nonce: String(values.nonce ?? ''),
              signature: values.signature ? String(values.signature) : undefined,
            })
            if (!r.ok) {
              // блокировка — не ошибка формы, а состояние: шаг с причиной и сроком
              if (r.fact.code === 'auth.blocked') {
                const raw = r.fact.args?.until
                commit()
                return {
                  data: {
                    step: 'blocked',
                    blocked: { reason: String(r.fact.args?.reason ?? 'не указана'), untilMs: typeof raw === 'number' && raw > 0 ? raw : null },
                  },
                }
              }
              return gone(r.fact)
            }
            const user = await vaultPayloadOf(r.value)
            // порядок шагов: восстановление → ограничения (каждый вход) → профиль → готово
            if (r.value.deletePending) {
              commit()
              return { data: { step: 'restore', user } }
            }
            if (r.value.restrictions.length > 0) {
              commit()
              return {
                data: {
                  step: 'restrictions',
                  user,
                  restrictions: r.value.restrictions.map((b) => ({ scope: b.scope, reason: b.reason, untilMs: b.until ?? null })),
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
          case 'restore': {
            const r = await u.cancelDelete()
            if (!r.ok) return gone(r.fact)
            commit()
            return { data: { step: 'done' } }
          }
          case 'profile': {
            const nickname = String(values.nickname ?? '').trim()
            const avatar = String(values.avatar ?? '')
            const r = await u.updateProfile({
              ...(nickname ? { nickname } : {}),
              ...(avatar ? { avatarUrl: avatar } : {}),
            })
            if (!r.ok) return gone(r.fact)
            commit()
            return { data: { step: 'done' } }
          }
          case 'skip-profile': {
            commit()
            return { data: { step: 'done' } }
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
            // данные для vault: значения токенов, срок — прямым составом data
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
    })
    const { result, status } = await handler(event.request, 'action', event)
    if (result.ok) {
      if (!isJs(event.request)) {
        const next = localPath(new URL(event.request.url).searchParams.get('next'))
        const step = (result.data as { step?: string } | undefined)?.step
        if (step && step !== 'entry' && step !== 'done') {
          redirect(303, `/user/auth?step=${step}${next ? `&next=${encodeURIComponent(next)}` : ''}`)
        }
        redirect(303, next ?? '/')
      }
      return { result }
    }
    return fail(status, { result })
  },
}
