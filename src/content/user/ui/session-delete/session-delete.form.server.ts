// Серверный POST единицы закрытия устройств. Один обработчик на два адреса:
// цель-аккаунт приходит параметром пути, набор — скрытыми полями формы.
// Права на каждую строку проверяет домен: клиентский набор — это просьба,
// а не разрешение.
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { auth } from '../../gateway.server.js'
import { instruction } from '../../index.js'
import { userAccountSessionsRoute, userSessionsRoute } from '../../routes.js'
import { parseSessionDeleteIds, parseSessionDeleteVariant } from '../../session-delete.js'
import { runBulkExit, sessionFormError } from '../../sessions-exit.server.js'
import { SESSIONS_FILTER_KEYS } from '../sessions-list/source.js'
import { sessionDeleteForm, sliceFieldName } from './form.js'

registerComponentForm({
  // Описание одно на клиент и сервер: набор приходит значениями полей.
  description: sessionDeleteForm(),
  execute: async ({ values, intent, commit, fail }, event) => {
    const u = auth(event)
    if (!u.enabled) return fail(instruction({ code: 'auth.disabled' }))
    if (intent !== 'delete') return fail(instruction({ code: 'auth.confirm' }))

    const variant = parseSessionDeleteVariant(values.variant)
    const params = event.params as Record<string, string | undefined>
    const targetId = params.id ?? null
    const { ids, tooMany } = parseSessionDeleteIds(undefined, values.ids)
    if (tooMany) return fail([sessionFormError('auth.limit', 'Слишком много устройств в наборе')])

    // Срез: набор считает домен по фильтру в момент отправки.
    const sliceField = Object.fromEntries(
      SESSIONS_FILTER_KEYS.map((key) => [key, String(values[sliceFieldName(key)] ?? '')]),
    )
    const isSlice = Object.values(sliceField).some((v) => v.trim() !== '')

    if (isSlice) {
      const r = await runBulkExit(
        event,
        { ...sliceField, spread: 'true' },
        {
          authId: targetId,
          selfHref: targetId
            ? userAccountSessionsRoute.href({ id: targetId })
            : userSessionsRoute.href(),
          doneHref: '/user/auth',
        },
      )
      if (!r.ok) return fail([r.error ?? sessionFormError('auth.unavailable')])
      commit()
      return { data: { step: 'done', variant, revoked: null, requested: null } }
    }

    if (ids.length === 0) {
      return fail([sessionFormError('auth.session-unknown', 'Не выбрано ни одного устройства')])
    }

    // Явный набор: этап S15 переведёт домен на набор одним вызовом; до тех пор
    // каждая строка закрывается своей дверью, и права перепроверяются на каждой.
    let revoked = 0
    for (const id of ids) {
      const r = await u.revokeSessionById(id)
      if (!r.ok) return fail([sessionFormError(r.fact.code)])
      revoked += 1
    }
    commit()
    return { data: { step: 'done', variant, revoked, requested: ids.length } }
  },
  redirectOnSuccess: (event) => {
    // Без JS переход объявлен здесь: своя сессия закрыта — на вход, иначе к списку.
    const params = event.params as Record<string, string | undefined>
    const targetId = params.id ?? null
    return targetId ? userAccountSessionsRoute.href({ id: targetId }) : userSessionsRoute.href()
  },
})
