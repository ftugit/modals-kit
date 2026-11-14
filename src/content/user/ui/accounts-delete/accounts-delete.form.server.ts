// Серверный POST единицы удаления аккаунтов.
//
// Форма набора ровно одна: `ids` отмеченных строк или срез списка. Смешивание
// и пустой набор — отказ разбора в домене, здесь только сборка значений.
// Права на каждую строку, запрет на себя и последнего администратора проверяет
// домен: клиентский набор — просьба, а не разрешение.
import { localPath } from '#lib/address/index.js'
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { auth } from '../../gateway.server.js'
import { instruction } from '../../index.js'
import { userListRoute } from '../../routes.js'
import {
  accountsDeleteForm,
  accountsSliceFrom,
  hasSliceFields,
  sliceFieldName,
} from './form.js'

registerComponentForm({
  description: accountsDeleteForm(),
  execute: async ({ values, intent, commit, fail }, event) => {
    const u = auth(event)
    if (!u.enabled) return fail(instruction({ code: 'auth.disabled' }))
    if (intent !== 'delete') return fail(instruction({ code: 'auth.confirm' }))

    const ids = String(values.ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const read = (key: string) => String(values[sliceFieldName(key)] ?? '')
    const slice = hasSliceFields(read)

    const r = await u.deleteAccountsBySet({
      ...(ids.length > 0 ? { ids } : {}),
      ...(slice ? { slice: accountsSliceFrom(read) } : {}),
    })
    if (!r.ok) return fail(instruction(r.fact))

    commit()
    return {
      data: {
        step: 'done',
        counts: r.value.counts,
      },
    }
  },
  redirectOnSuccess: (event) => {
    // Без JS: возвращаемся к списку аккаунтов — там виден новый срез.
    return localPath(event.url.searchParams.get('next')) ?? userListRoute.href()
  },
})
