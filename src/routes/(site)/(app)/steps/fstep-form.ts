// Демо форм-режима шагов (/steps, раздел 4): ОДНА форма, шаги — её нарезка.
// Экшен шага проверяет только свои поля (`subset`), финальный `save` — всё;
// переход между шагами — submit с интенцией экшена, не ссылка. Поля свёрнутых
// шагов не вырезаются из DOM и едут в каждом POST.
import { defineForm, field, v } from '#lib/form/index.js'
import { defineDemoPanel } from '#lib/components/demo/index.js'

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


/* ── панель демо (`?demo=`, `?nav`, `?filled`) — СХЕМА универсальной панели ──
   Данные, которые раньше жили в `defineForm` страницы: режим — сценарное поле
   (смена пересобирает адрес), тумблеры — умолчания не пишутся; выключения
   зависят от режима. Адрес, seed, «Применить» и GET без JS ведёт DemoPanel. */

/** Режимы демо; jsOnly-варианты до оживления просто выключены — как в других панелях. */
export const DEMO_MODES = [
  { value: 'url', label: 'Адрес (?ustep)', jsOnly: false },
  { value: 'local', label: 'Локально', jsOnly: true },
  { value: 'hybrid', label: 'Адрес + локально (?hstep)', jsOnly: true },
  { value: 'form', label: 'Форма (subset-шаги)', jsOnly: false },
] as const

export type DemoMode = (typeof DEMO_MODES)[number]['value']

export const demoPanelSchema = defineDemoPanel<{ demo: string; nav: boolean; filled: boolean }>({
  id: 'steps-demo',
  action: '/steps',
  fields: [
    {
      type: 'select',
      key: 'demo',
      label: 'Режим демо',
      hint: 'Ключ режима — ?demo (своя бронь; ?ustep/?hstep — ключи шагов)',
      options: DEMO_MODES.map((m) => ({ value: m.value, label: m.label, jsOnly: m.jsOnly })),
      defaultValue: 'url',
      url: { omitWhenDefault: true },
      resetsScenario: true,
    },
    {
      type: 'toggle',
      key: 'nav',
      label: 'Навигация по шагам сверху',
      defaultValue: true,
      url: { omitWhenDefault: true },
      disabledWhen: (v) => (v.demo === 'form' ? 'В форм-режиме шаги не адресуются' : undefined),
    },
    {
      type: 'toggle',
      key: 'filled',
      label: 'Пройденные шаги — ссылками',
      defaultValue: true,
      url: { omitWhenDefault: true },
      disabledWhen: (v) =>
        v.demo === 'form'
          ? 'В форм-режиме шаги не адресуются'
          : v.demo === 'local'
            ? 'Локальные шаги не адресуются'
            : undefined,
    },
  ],
})
