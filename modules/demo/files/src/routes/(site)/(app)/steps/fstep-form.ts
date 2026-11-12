// Демо форм-режима шагов (/steps, раздел 4): ОДНА форма, шаги — её нарезка.
// Экшен шага проверяет только свои поля (`subset`), финальный `save` — всё;
// переход между шагами — submit с интенцией экшена, не ссылка. Поля свёрнутых
// шагов не вырезаются из DOM и едут в каждом POST.
import { defineForm, field, v } from '#lib/form/index.js'

/** Шаги демо: ключ = id экшена, который его проверяет и уводит дальше.
 *  Финальный шаг — «Примечание»: его кнопка отправляет форму на сервер. */
export const FSTEP_STEPS = [
  { key: 'contacts', label: 'Контакты' },
  { key: 'extra', label: 'Примечание' },
] as const

export type FstepStep = (typeof FSTEP_STEPS)[number]['key']

/** Куда ведёт успешный шаг (знают и страница, и экшен); финал сам на себя. */
export const FSTEP_NEXT: Record<FstepStep, FstepStep> = {
  contacts: 'extra',
  extra: 'extra',
}

export const fstepForm = defineForm({
  id: 'fstep',
  revision: 1,
  actions: [
    { id: 'contacts', label: 'Далее: примечание', validate: 'partial', subset: ['name', 'email'] },
    { id: 'extra', label: 'Далее: готово', validate: 'partial', subset: ['note'] },
    { id: 'save', label: 'Сохранить', validate: 'full' }, // финальный: проверяет всю форму
  ],
  fields: {
    name: field.text({ label: 'Имя', validate: [v.required()] }),
    email: field.text({
      label: 'Электропочта',
      help: 'Сервер принимает только test@test.local — правило только на сервере: при финальном сохранении ошибка раскроет этот (к тому времени скрытый) шаг.',
      validate: [v.required(), v.email()],
    }),
    note: field.text({ label: 'Примечание', validate: [v.required()] }),
  },
})
