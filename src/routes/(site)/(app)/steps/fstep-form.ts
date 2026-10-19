// Демо форм-режима шагов (/steps, раздел 4): ОДНА форма, шаги — её нарезка.
// Экшен шага проверяет только свои поля (`subset`), финальный `save` — всё;
// переход между шагами — submit с интенцией экшена, не ссылка. Поля свёрнутых
// шагов не вырезаются из DOM и едут в каждом POST.
import { defineForm, field, v } from '#lib/form/index.js'

/** Шаги демо: ключ = id экшена, который его проверяет и уводит дальше. */
export const FSTEP_STEPS = [
  { key: 'contacts', label: 'Контакты' },
  { key: 'extra', label: 'Примечание' },
  { key: 'done', label: 'Готово' },
] as const

export type FstepStep = (typeof FSTEP_STEPS)[number]['key']

/** Куда ведёт успешный шаг (знают и страница, и экшен). */
export const FSTEP_NEXT: Record<FstepStep, FstepStep> = {
  contacts: 'extra',
  extra: 'done',
  done: 'done',
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


/* ── панель демо (`?demo=`, `?nav`, `?filled`) ────────────────────────── */

/** Режимы демо: подписи и то, что требует оживления (смена шагов — клиентская). */
export const DEMO_MODES = [
  { value: 'url', label: 'Адрес (?ustep)', jsOnly: false },
  { value: 'local', label: 'Локально', jsOnly: true },
  { value: 'hybrid', label: 'Адрес + локально (?hstep)', jsOnly: true },
  { value: 'form', label: 'Форма (subset-шаги)', jsOnly: false },
] as const

export type DemoMode = (typeof DEMO_MODES)[number]['value']

export const demoPanelForm = defineForm({
  id: 'steps-demo',
  revision: 1,
  actions: [{ id: 'apply', label: 'Применить', validate: 'none' }],
  fields: {
    demo: field.select({
      label: 'Режим демо',
      options: DEMO_MODES.map((m) => ({ value: m.value, label: m.label })),
      defaultValue: 'url',
    }),
    nav: field.checkbox({ label: 'Навигация по шагам сверху', defaultValue: true }),
    filled: field.checkbox({ label: 'Пройденные шаги — ссылками', defaultValue: true }),
  },
})
