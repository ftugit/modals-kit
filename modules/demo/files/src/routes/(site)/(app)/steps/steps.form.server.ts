// Серверный POST-обработчик демо-формы шагов (`#hooks/component-form`).
//
// Раньше это был `actions.default` маршрута: страница платила своей серверной
// точкой входа ради одной формы, а форма шагов — единственная на демо, которой
// нужен приём «куда бы её ни вставили» (страница, шаг чужого хоста, модалка).
// Теперь приём — там же, где у остальных встраиваемых форм: конверт называет
// `__form_id`, обработчик находит регистрацию и отвечает той же кодировкой.
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { FSTEP_NEXT, fstepForm, type FstepStep } from './fstep-form.js'

registerComponentForm({
  description: fstepForm,
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
  // Успех без JS — страница в том же ответе: шаг и баннер стоят на результате
  // (и `formSteps`, и `FormSteps` читают его как продолжение). `303` потерял бы
  // ответ и вернул человека на первый шаг.
  redirectOnSuccess: () => 'inline',
})
