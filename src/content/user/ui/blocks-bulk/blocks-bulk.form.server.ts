// Серверный POST единицы наборных действий над блокировками.
//
// Набор ровно одной формы: `ids` отмеченных строк или срез списка. Смешивание
// и пустой набор — отказ разбора в домене, здесь только сборка значений.
// Права на каждую строку проверяет домен: клиентский набор — просьба, а не
// разрешение.
import { localPath } from '#lib/address/index.js'
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { auth } from '../../gateway.server.js'
import { instruction } from '../../index.js'
import { blocksListRoute } from '../../routes.js'
import {
  BLOCKS_BULK_INTENTS,
  blocksBulkForm,
  blocksSliceFrom,
  hasSliceFields,
  sliceFieldName,
  type BlocksBulkIntent,
} from './form.js'

registerComponentForm({
  description: blocksBulkForm(),
  execute: async ({ values, intent, commit, fail }, event) => {
    const u = auth(event)
    if (!u.enabled) return fail(instruction({ code: 'auth.disabled' }))
    if (!BLOCKS_BULK_INTENTS.includes(intent as BlocksBulkIntent)) {
      return fail(instruction({ code: 'auth.confirm' }))
    }

    const ids = String(values.ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const read = (key: string) => String(values[sliceFieldName(key)] ?? '')
    const slice = hasSliceFields(read)

    const args = {
      ...(ids.length > 0 ? { ids } : {}),
      ...(slice ? { slice: blocksSliceFrom(read) } : {}),
    }
    const r =
      intent === 'delete' ? await u.deleteBlocksBySet(args) : await u.liftBlocksBySet(args)
    if (!r.ok) return fail(instruction(r.fact))

    commit()
    return {
      data: {
        step: 'done',
        intent: intent as BlocksBulkIntent,
        counts: r.value.counts,
      },
    }
  },
  redirectOnSuccess: (event) => {
    // Без JS: возвращаемся к списку блокировок — там виден новый срез.
    return localPath(event.url.searchParams.get('next')) ?? blocksListRoute.href()
  },
})
