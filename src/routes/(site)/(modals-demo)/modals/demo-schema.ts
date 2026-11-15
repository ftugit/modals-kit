/**
 * Схема демо-панели `/modals` — ДАННЫЕ и только данные.
 *
 * Панель настроек хоста модалок переехала на универсальный `DemoPanel`
 * (этап 3): адреса у этих полей нет (`url: false`) — значения уходят
 * ПАРАМЕТРАМИ приёмнику (`toParams` → `modals.configure`), а зеркало в
 * обратную сторону панель держит сама (`values` + живая сверка).
 *
 * Файл без SvelteKit и без `.svelte`: его импортирует скан-тест
 * (`src/components/demo/schemas.test.ts`) вне приложения, поэтому ошибка
 * в схеме видна на сборке.
 */
import { defineDemoPanel, demoSelect, demoText } from '#components/demo/define.js'

/** Значения панели: ключи полей — имена контролов (они же имена полей формы). */
export type ModalsDemoValues = {
  default_mobile: string
  floating_mobile: string
  open_animation: string
  close_animation: string
  stack_animation: string
  tail_direction: string
  max_height: string
  clear_on_close: string
  tail_count: string
}

/** Порядок вывода списков в своей разметке (`ModalsDemoFields`). */
export const MODALS_SELECTS = [
  'default_mobile',
  'floating_mobile',
  'open_animation',
  'close_animation',
  'stack_animation',
  'tail_direction',
  'max_height',
  'clear_on_close',
] as const

export const demoPanelSchema = defineDemoPanel<ModalsDemoValues>({
  id: 'modals-demo',
  // Адресных полей нет: нативная GET-форма без JS ведёт на ту же страницу.
  action: '/modals',
  fields: [
    demoSelect({
      key: 'default_mobile',
      label: 'Мобильный режим (умолчание)',
      url: false,
      defaultValue: 'off',
      options: [
        { value: 'off', label: 'выкл' },
        { value: 'bottom', label: 'низ' },
        { value: 'top', label: 'верх' },
        { value: 'left', label: 'лево' },
        { value: 'right', label: 'право' },
      ],
    }),
    demoSelect({
      key: 'floating_mobile',
      label: 'Мобильный режим popup-меню (умолчание)',
      url: false,
      defaultValue: 'on',
      options: [
        { value: 'on', label: 'как у модалок' },
        { value: 'off', label: 'выпадашка' },
      ],
    }),
    demoSelect({
      key: 'open_animation',
      label: 'Анимация открытия',
      url: false,
      defaultValue: 'scale',
      options: [
        { value: 'scale', label: 'scale' },
        { value: 'fade', label: 'fade' },
        { value: 'slide-up', label: 'slide' },
        { value: 'none', label: 'выкл' },
      ],
    }),
    demoSelect({
      key: 'close_animation',
      label: 'Анимация закрытия',
      url: false,
      defaultValue: 'scale',
      options: [
        { value: 'scale', label: 'scale' },
        { value: 'fade', label: 'fade' },
        { value: 'slide-down', label: 'slide' },
        { value: 'none', label: 'выкл' },
      ],
    }),
    demoSelect({
      key: 'stack_animation',
      label: 'Анимация стопки',
      url: false,
      defaultValue: 'cards',
      options: [
        { value: 'cards', label: 'карты' },
        { value: 'deck', label: 'колода' },
        { value: 'fan', label: 'веер' },
        { value: 'none', label: 'выкл' },
      ],
    }),
    demoSelect({
      key: 'tail_direction',
      label: 'Направление хвостов',
      url: false,
      defaultValue: 'bottom',
      options: [
        { value: 'bottom', label: 'вниз' },
        { value: 'top', label: 'вверх' },
        { value: 'left', label: 'влево' },
        { value: 'right', label: 'вправо' },
        { value: 'none', label: 'выкл' },
      ],
    }),
    demoSelect({
      key: 'max_height',
      label: 'Макс. высота модалки',
      url: false,
      defaultValue: '80vh',
      options: [
        { value: '60vh', label: '60vh' },
        { value: '70vh', label: '70vh' },
        { value: '80vh', label: '80vh' },
        { value: '90vh', label: '90vh' },
      ],
    }),
    demoSelect({
      key: 'clear_on_close',
      label: 'Очистка памяти после закрытия',
      url: false,
      defaultValue: 'false',
      options: [
        { value: 'false', label: 'хранить' },
        { value: 'true', label: 'очищать' },
      ],
    }),
    demoText({
      key: 'tail_count',
      label: 'Число хвостов',
      url: false,
      defaultValue: '3',
    }),
  ],
  /**
   * Параметры приёмника: имена `HostConfig` (camelCase) и доменные типы.
   * `configure()` игнорирует `undefined` — пустое значение сюда не попадает.
   */
  toParams: (v) => ({
    defaultMobile: v.default_mobile,
    floatingMobile: v.floating_mobile === 'on',
    openAnimation: v.open_animation,
    closeAnimation: v.close_animation,
    stackAnimation: v.stack_animation,
    tailDirection: v.tail_direction,
    maxHeight: v.max_height,
    clearOnClose: v.clear_on_close === 'true',
    tailCount: Number(v.tail_count),
  }),
})
