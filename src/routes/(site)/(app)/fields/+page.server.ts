// Нативный путь `/fields`: form-экшены поверх тех же слоёв, что и перехват
// (`./save`, `./record`). Данные страницы — из кэша процесса.
//
// Страница идёт тремя шагами («сборка, заполнение, результат»): шаг живёт в
// адресе (`?step=…`), поэтому шаги — обычные ссылки и без скрипта. Успех
// экшена уводит на следующий шаг (redirect, PRG), отказ и намерения мест
// («+ поле», «Удалить») остаются на своём шаге с набранным.
import { fail, redirect, type Actions } from '@sveltejs/kit'
import type { Handled } from '#lib/form/server.js'
import { clearFieldsDemo, handleBuilder, handleRecord, savedRecord, savedSet } from './handle'
import { MAX_FIELDS, maxFieldsOf, stepOf, type FieldsStep } from './forms'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = ({ url }) => {
  const set = savedSet()
  const record = savedRecord()
  return {
    set,
    record,
    step: stepOf(url.searchParams.get('step'), !!set, !!record),
    // Демо-опция из адреса: по ней строится описание формы на обеих сторонах.
    limit: maxFieldsOf(url.searchParams.get('limit')),
  }
}

/** Опции демо переживают переход шага: иначе предел молча вернулся бы к умолчанию. */
const limitTail = (url: URL): string => {
  const n = maxFieldsOf(url.searchParams.get('limit'))
  return n === MAX_FIELDS ? '' : `&limit=${n}`
}

/**
 * `intent` — какой из форм достался ответ: `form` у SvelteKit один на страницу.
 * `own` — шаг этой формы (отказ и намерения остаются на нём), `next` — шаг после
 * настоящего сохранения.
 */
async function act(
  event: { url: URL },
  intent: 'save' | 'record',
  promise: Promise<Handled>,
  own: FieldsStep,
  next: FieldsStep,
) {
  const { result, status } = await promise
  if (result.ok && result.outcome !== 'not-applied')
    redirect(303, `/fields?step=${next}${limitTail(event.url)}`)
  return result.ok ? { result, intent, step: own } : fail(status, { result, intent, step: own })
}

export const actions: Actions = {
  save: (event) => act(event, 'save', handleBuilder(event.request, 'action', event), 'build', 'fill'),
  record: (event) => act(event, 'record', handleRecord(event.request, 'action', event), 'fill', 'result'),
  reset: (event) => {
    // сброс очищает набор и запись и возвращает на «Сборку» (та же цель PRG)
    clearFieldsDemo()
    redirect(303, `/fields?step=build${limitTail(event.url)}`)
  },
}
