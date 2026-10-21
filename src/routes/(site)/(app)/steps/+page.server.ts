// Приём демо-формы шагов (/steps, раздел 4). Экшен один на страницу:
// намерение различает конверт. Шаг после ответа ведёт сам formSteps на
// клиенте: отправленный срез он выводит из Result.intent, следующий при
// успехе сервер называет в данных результата (data.step) — обёртка вокруг
// результата шагу не нужна, JS и no-JS идут одним каналом.
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
    // следующий шаг — решение приложения: «Далее» ведёт по FSTEP_NEXT;
    // «Сохранить» не ведёт ни на какой новый шаг — остаёмся на финальном,
    // итог сообщает баннер над формой (data.saved). Провал шаг не называет:
    // formSteps останется на отправленном срезе по Result.intent.
    return {
      data: intent === 'save'
        ? { step: 'extra', saved: true }
        : { step: FSTEP_NEXT[intent as FstepStep] ?? 'contacts' },
    }
  },
})

async function act(event: Parameters<Actions['default']>[0]) {
  const { result, status } = await handle(event.request, 'action', event)
  return result.ok && result.outcome !== 'not-applied' ? { result } : fail(status, { result })
}

export const actions: Actions = { default: act }
