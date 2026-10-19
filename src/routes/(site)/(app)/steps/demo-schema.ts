/**
 * Схема демо-панели `/steps` — ДАННЫЕ и только данные.
 *
 * Файл нарочно без SvelteKit и без `.svelte`: его импортирует скан-тест
 * (`src/lib/components/demo/schemas.test.ts`) вне приложения, поэтому ошибка в
 * схеме видна на сборке. Объявлять схемы панелей принято в `demo-schema.ts`
 * рядом со страницей — скан ловит `defineDemoPanel` в других файлах.
 */
import { defineDemoPanel, demoSelect, demoToggle } from '#lib/components/demo/define.js'

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
    demoSelect({
      key: 'demo',
      label: 'Режим демо',
      hint: 'Ключ режима — ?demo (своя бронь; ?ustep/?hstep — ключи шагов)',
      options: DEMO_MODES.map((m) => ({ value: m.value, label: m.label, jsOnly: m.jsOnly })),
      defaultValue: 'url',
      url: { omitWhenDefault: true },
      resetsScenario: true,
    }),
    demoToggle({
      key: 'nav',
      label: 'Навигация по шагам сверху',
      defaultValue: true,
      url: { omitWhenDefault: true },
      disabledWhen: (v) => (v.demo === 'form' ? 'В форм-режиме шаги не адресуются' : undefined),
    }),
    demoToggle({
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
    }),
  ],
})
