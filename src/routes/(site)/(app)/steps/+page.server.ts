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
    // серверная-only проверка: правило, которого нет в описании формы, увидит
    // только сервер. Обе ошибки — про поля ПЕРВОГО шага: на финальном сохранении
    // этот шаг уже скрыт, разбор раскрывает его и показывает поле с ошибкой.
    const problems = []
    if (intent === 'save' && String(values['name'] ?? '').toLowerCase().includes('ошибка'))
      problems.push({
        id: 'fstep.server-name',
        code: 'fstep.server-name',
        message: 'Сервер не пропустил имя «ошибка» — исправьте на шаге «Контакты».',
        path: 'name',
        origin: 'server' as const,
      })
    if (intent === 'save' && String(values['email'] ?? '') !== 'test@test.local')
      problems.push({
        id: 'fstep.server-email',
        code: 'fstep.server-email',
        message: 'Сервер принимает только test@test.local — поле с шага «Контакты» (демо скрытого шага).',
        path: 'email',
        origin: 'server' as const,
      })
    if (problems.length) fail(problems)
    commit()
    // шаг едет в данных результата: с JS его читает страница (Result.data.step),
    // без JS — обёртка экшена. «Сохранить» не ведёт ни на какой новый шаг —
    // остаёмся на финальном, итог сообщает баннер над формой (data.saved).
    return {
      data: intent === 'save'
        ? { step: 'extra', saved: true }
        : { step: FSTEP_NEXT[intent as FstepStep] ?? 'contacts' },
    }
  },
})

/** Ключ намерения в конверте — из политики формы, не хардкод. */
const INTENT_KEY = fstepForm.policy.envelopeKeys.intent

/**
 * Шаг, где стоит кнопка: намерение конверта (тело нельзя читать дважды —
 * clone). Финальная кнопка «Сохранить» стоит на шаге «Примечание» — провал
 * возвращает туда, а не на мифический шаг 'save'.
 */
const ownStep = async (request: Request): Promise<FstepStep> => {
  const raw = await request.clone().formData().catch(() => null)
  const intent = String(raw?.get(INTENT_KEY) ?? 'contacts')
  if (intent === 'save') return 'extra'
  return (Object.keys(FSTEP_NEXT) as FstepStep[]).find((s) => s === intent) ?? 'contacts'
}

async function act(event: Parameters<Actions['default']>[0]) {
  const raw = await event.request.clone().formData().catch(() => null)
  const intent = String(raw?.get(INTENT_KEY) ?? '')
  const own = await ownStep(event.request)
  const { result, status } = await handle(event.request, 'action', event)
  // успех настоящего сохранения уводит на следующий шаг (save — на «Готово»),
  // провал оставляет на своём; ОБА канала обязаны вести шаг одинаково:
  // с JS его читают из Result.data.step, без JS — из этой обёртки
  return result.ok && result.outcome !== 'not-applied'
    ? { result, step: FSTEP_NEXT[own] }
    : fail(status, { result, step: own })
}

export const actions: Actions = { default: act }
