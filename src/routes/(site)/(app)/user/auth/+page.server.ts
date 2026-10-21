// Роут авторизации: ДВЕ формы — `authForm` (срезы входа различает интент) и
// `profileForm` (шаг профиля после входа). Приём — через слои `lib/form`
// (метод, origin, тело, имена, конверт); какая форма пришла, говорит конверт
// (`__form_id`) — по нему выбирается обработчик. Бизнес — голые функции
// `auth.ts`. REST нет, по решению владельца.
//
// Шаг — ПОЛНЫЙ ключ цепочки шагов в адресе страницы (`?stage=auth.restore`;
// бронь ключей глобальна: `step` занят /fields): первый сегмент — шаг хоста,
// остаток — срез формы. С JS экшен отвечает данными (транспорт виджета шлёт
// accept: application/json); без JS успех входа — redirect(303) на адрес
// следующего шага или на `next`.
import { fail, redirect } from '@sveltejs/kit'
import { localPath } from '#lib/address/index.js'
import type { Actions, PageServerLoad } from './$types'
import type { RequestEvent } from '@sveltejs/kit'
import { createFormHandler, type ExecuteContext } from '#lib/form/server.js'
import { SECURITY_LAYERS } from '#lib/server/form-security.js'
import { auth, readVault, vaultPayloadOf } from '#content/user/gateway.js'
import { authForm, profileForm, PROFILE_FORM_ID } from '#content/user/forms.js'
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
  // `event.url`, а не `event.request.url`: только accessor объявляет зависимость
  // load от поиска — иначе при смене `?stage=` по ссылке load не перезапускается,
  // и шаг на клиенте не переключается (SPA считал бы адрес мёртвым).
  const url = event.url
  // ключ `stage` (не `step`): бронь ключей глобальна, `step` занят /fields
  const stepParam = url.searchParams.get('stage')
  let step = (stepParam && (LEGACY_STEP[stepParam] ?? stepParam)) || 'auth.entry'
  let registerSeed: string | null = null
  if (step === 'auth.register') {
    // без JS seed делает сервер (решение владельца); секрет едет в поле страницы
    const { generateKeyPair } = await import('#content/user/keys.js')
    registerSeed = (await generateKeyPair()).secret
  }
  const u = auth(event)
  // вход выключен — challenge не выдаётся, форма скрыта (сообщение в виджете)
  const challenge = u.enabled ? await u.issueChallenge() : null
  const user = await readVault(event.cookies).catch(() => null)
  // шаги после входа без сессии не показываем: deep-link на профиль или
  // ограничения сворачивается на вход (данные этих шагов несёт ответ
  // экшена, а не адрес)
  if (!user && (step === 'profile' || step === 'restrictions' || step === 'blocked')) step = 'auth.entry'
  return {
    enabled: u.enabled,
    challenge: challenge?.ok ? challenge.value : null,
    next: localPath(url.searchParams.get('next')),
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
    // Замыкание event: execute нужны куки (токены ставит фасад). Обработчик
    // собирается на запрос — это объект-обёртка, не состояние.
    const u = auth(event)

    const authExecute = async ({ values, intent, commit, fail }: ExecuteContext) => {
      const gone = (fact: Parameters<typeof instruction>[0]) => fail(instruction(fact))
      // блокировка — не ошибка формы, а состояние: шаг с причиной и сроком
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
      // общий хвост успешного входа/восстановления (сессия уже выдана
      // фасадом): порядок шагов — ограничения (каждый вход) → профиль → готово
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
      // вход выключен: экшены честно отказывают (кроме выхода — куки чистить можно)
      if (!u.enabled && intent !== 'logout') return gone({ code: 'auth.disabled' })
      switch (intent) {
        case 'login': {
          // длину/вид seed проверила форма (required + pattern): до execute
          // доходит только значение формата base64url 43–44
          const derived = await seedOf(String(values.seed ?? '').trim())
          const r = await u.login({
            seed: derived,
            nonce: String(values.nonce ?? ''),
            signature: values.signature ? String(values.signature) : undefined,
          })
          if (!r.ok) {
            if (r.fact.code === 'auth.blocked') return blockedStep(r.fact)
            // удалённый аккаунт — тоже состояние, не ошибка: шаг
            // восстановления; сессии нет и быть не должно (политика)
            if (r.fact.code === 'auth.deleted') {
              commit()
              return { data: { step: 'restore' } }
            }
            return gone(r.fact)
          }
          return entered(r.value)
        }
        case 'restore': {
          // подтверждение восстановления: seed доехал скрытым полем шага;
          // доказательство проверяет ядро ДО касания удалённой строки
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
    }

    // профиль — своя форма и свой execute: сессию несёт фасад (куки),
    // подпись не нужна; «пропустить» отправкой не является — здесь его нет
    const profileExecute = async ({ values, intent, commit, fail }: ExecuteContext) => {
      if (intent !== 'profile') return fail(instruction({ code: 'auth.confirm' }))
      const nickname = String(values.nickname ?? '').trim()
      const avatar = String(values.avatar ?? '')
      const r = await u.updateProfile({
        ...(nickname ? { nickname } : {}),
        ...(avatar ? { avatarUrl: avatar } : {}),
      })
      if (!r.ok) return fail(instruction(r.fact))
      commit()
      // ник/аватар запечатаны в access-токене: перевыпуск (renew) освежает
      // их везде сразу — куки/SSR сами, vault клиента — через `user` в
      // ответе; без этого UI показывал профиль на момент входа
      let user: unknown
      try {
        const renewed = await u.renew()
        if (renewed.ok) user = await vaultPayloadOf(renewed.value)
      } catch { /* профиль уже сохранён; освежит обычное продление */ }
      return { data: { step: 'done', ...(user ? { user } : {}) } }
    }

    // какая форма пришла — говорит конверт; тело читается клоном (обработчик
    // перечитает сам), неизвестный id уходит в auth-обработчик и честно
    // откажет на сверке конверта
    const raw = await event.request.clone().formData().catch(() => null)
    const handler = raw?.get(authForm.policy.envelopeKeys.id) === PROFILE_FORM_ID
      ? createFormHandler<unknown, RequestEvent>({ description: profileForm, order: SECURITY_LAYERS, execute: profileExecute })
      : createFormHandler<unknown, RequestEvent>({ description: authForm, order: SECURITY_LAYERS, execute: authExecute })
    const { result, status } = await handler(event.request, 'action', event)
    if (result.ok) {
      const step = (result.data as { step?: string } | undefined)?.step
      // шаг восстановления: redirect потерял бы значения формы, а seed нужен
      // отправке подтверждения — без JS страница перерисовывается продолжением
      if (!isJs(event.request) && step !== 'restore') {
        const next = localPath(new URL(event.request.url).searchParams.get('next'))
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
