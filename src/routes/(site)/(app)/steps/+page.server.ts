// Приём демо-формы шагов (/steps, раздел 4). Экшен один на страницу:
// намерение различает конверт (`__form_intent`). Ответ всегда несёт шаг:
// успех — куда ехать дальше, провал — где остаться (no-JS: адрес шаг не
// меняет, маркер может приехать только из ответа).
import { fail, type Actions } from '@sveltejs/kit'
import { createFormHandler } from '#lib/form/server.js'
import { SECURITY_LAYERS } from '#lib/server/form-security.js'
import '#lib/components/form/extend.js'
import { FSTEP_NEXT, fstepForm, type FstepStep } from './fstep-form.js'

const handle = createFormHandler({
  description: fstepForm,
  order: SECURITY_LAYERS,
  execute({ intent, values, commit, fail }) {
    // серверная-only ошибка для демо разбора: имя «ошибка» ловит только сервер
    if (intent === 'save' && String(values['name'] ?? '').toLowerCase().includes('ошибка'))
      fail([
        {
          id: 'fstep.server-name',
          code: 'fstep.server-name',
          message: 'Сервер не пропустил имя «ошибка» — исправьте на шаге «Контакты».',
          path: 'name',
          origin: 'server',
        },
      ])
    commit()
    // следующий шаг едет в данных результата: с JS его читает страница
    // (Result.data.step), без JS шаг вернёт обёртка экшена
    return { data: { step: FSTEP_NEXT[intent as FstepStep] ?? 'done' } }
  },
})

/** Шаг, где стоит кнопка: намерение конверта (тело нельзя читать дважды — clone). */
const ownStep = async (request: Request): Promise<FstepStep> => {
  const raw = await request.clone().formData().catch(() => null)
  const intent = String(raw?.get('__form_intent') ?? 'contacts')
  return (Object.keys(FSTEP_NEXT) as FstepStep[]).find((s) => s === intent) ?? 'contacts'
}

async function act(event: Parameters<Actions['default']>[0]) {
  const own = await ownStep(event.request)
  const { result, status } = await handle(event.request, 'action', event)
  // успех настоящего сохранения уводит на следующий шаг, провал оставляет на своём
  return result.ok && result.outcome !== 'not-applied'
    ? { result, step: FSTEP_NEXT[own] }
    : fail(status, { result, step: own })
}

export const actions: Actions = { default: act }
