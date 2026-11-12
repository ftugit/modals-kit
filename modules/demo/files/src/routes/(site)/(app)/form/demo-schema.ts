/**
 * Схема демо-панели `/form` — ДАННЫЕ и только данные (этап 4).
 *
 * До этого файла настройки жили в самой странице: форма `bind` + разметка
 * `settings/{Field,Select,Toggle}` в трёх местах, и каждое поле рисовалось
 * руками. Теперь поля — данные, а форму, «Применить» до оживления и параметры
 * ведёт универсальная `DemoPanel`.
 *
 * Адреса у полей нет (`url: false`): это настройки ДЕМОНСТРАЦИИ, а не сценарий,
 * которым делятся ссылкой. Значения уходят на страницу параметрами, и она
 * подставляет их в `if/else` — как панель модалок отдаёт свой конфиг.
 *
 * Файл без SvelteKit и без `.svelte`: его импортирует скан-тест
 * (`src/components/demo/schemas.test.ts`) вне приложения.
 */
import { defineDemoPanel, demoDivider, demoSelect, demoToggle } from '#components/demo/define.js'
import type { DemoValues } from '#components/demo/types.js'
import { PSP_SAMPLES } from './psp'

/** Значения панели: ключи полей — имена контролов (они же id, как раньше). */
export type FormDemoValues = {
  mode: string
  invalid_from: string
  intercept: string
  live: string
  cardinality: string
  markup: string
  parallel: string
  answer: string
  with_type: boolean
  described: boolean
  sample: string
}

export const FORM_HINTS: Record<string, Record<string, string>> = {
  mode: {
    'as-is': 'ошибки остаются у своих полей',
    'one-block': 'обработчик стирает имена полей: все ошибки уходят в общий блок над формой, подсветка переключается «по показу»',
    'drop-code': 'обработчик выбрасывает ошибку «слишком коротко»: текста нет, но поле знает, что неверно',
    'to-channel': 'ошибки почты уходят в «Внешний канал» под формой и в самой форме не видны',
  },
  invalid_from: {
    fact: 'поле красное, если ошибка есть, даже когда обработчик убрал её текст',
    shown: 'поле красное, только если его ошибка показана',
  },
  intercept: {
    js: 'отправка запросом из скрипта, страница не перезагружается',
    native: 'обычная отправка браузером: страница перезагружается, ошибки приходят в новой разметке',
  },
  live: {
    'after-touched': 'проверка при уходе из поля, а после первого ухода — на каждом вводе',
    'on-blur': 'проверка только при уходе из поля',
    'on-input': 'проверка на каждом вводе, даже до первого ухода',
    'on-submit': 'проверка только при отправке',
  },
  cardinality: {
    first: 'у поля видна одна ошибка — первая по порядку правил',
    all: 'у поля виден весь список ошибок; это свойство описания, поэтому форма собирается заново, и сервер получает ту же настройку',
  },
  markup: {
    default: 'идентификаторы полей вида signup-email, проверка — по «Режиму живой проверки»',
    custom: 'свои идентификаторы (fld_signup__email) и проверка на каждом вводе: настройка приложения, библиотека не меняется',
  },
  parallel: {
    block: 'пока отправка идёт, повторное нажатие не уходит',
    replace: 'новая отправка отменяет идущую',
    queue: 'новая отправка ждёт конца текущей и уходит сама',
  },
  answer: {
    accept: 'сервер сохраняет и отвечает «готово»',
    redirect: 'сервер сохраняет и велит перейти на другой адрес: со скриптом переходит страница, без него — ответ 303',
    queued: 'сервер принимает заявку и отвечает сразу, а запись готова через 5 секунд: страница сама спрашивает, готово ли; без скрипта — ссылка на статус',
    unknown: 'сервер не подтвердил успех: исход «неизвестно», повтор может задвоить запись; событие уходит в канал системных ошибок',
  },
}

/**
 * Описание выбранного значения — рядом с подписью поля: что именно изменится
 * в форме. Тексты — забота страницы, а не библиотеки (в `Option` описания нет);
 * `hintOf` получает ЖИВЫЕ значения, поэтому подсказка меняется вместе с выбором.
 */
const hintOf = (key: keyof FormDemoValues) => (values: DemoValues) => FORM_HINTS[key]?.[String(values[key])]

/** Предел — только на клиенте: до оживления панель не может применить настройку. */
const jsOnly = true

export const demoPanelSchema = defineDemoPanel<FormDemoValues>({
  id: 'form-demo',
  // Адресных полей нет: нативная GET-форма без JS ведёт на ту же страницу.
  action: '/form',
  fields: [
    demoSelect({
      key: 'mode',
      label: 'Обработчик ошибок',
      url: false,
      jsOnly,
      defaultValue: 'as-is',
      hintOf: hintOf('mode'),
      options: [
        { value: 'as-is', label: 'как есть' },
        { value: 'one-block', label: 'всё в общий' },
        { value: 'drop-code', label: 'без minLength' },
        { value: 'to-channel', label: 'почту — в канал' },
      ],
    }),
    demoSelect({
      key: 'invalid_from',
      label: 'Откуда берётся подсветка',
      url: false,
      jsOnly,
      defaultValue: 'fact',
      hintOf: hintOf('invalid_from'),
      options: [
        { value: 'fact', label: 'по факту' },
        { value: 'shown', label: 'по показу' },
      ],
    }),
    demoSelect({
      key: 'intercept',
      label: 'Перехват отправки',
      url: false,
      jsOnly,
      defaultValue: 'js',
      hintOf: hintOf('intercept'),
      options: [
        { value: 'js', label: 'перехватывать' },
        { value: 'native', label: 'нативно' },
      ],
    }),
    demoSelect({
      key: 'live',
      label: 'Режим живой проверки',
      url: false,
      jsOnly,
      defaultValue: 'after-touched',
      hintOf: hintOf('live'),
      options: [
        { value: 'after-touched', label: 'после касания' },
        { value: 'on-blur', label: 'при уходе' },
        { value: 'on-input', label: 'при вводе' },
        { value: 'on-submit', label: 'при отправке' },
      ],
    }),
    demoSelect({
      key: 'cardinality',
      label: 'Сколько ошибок на поле',
      url: false,
      jsOnly,
      defaultValue: 'first',
      hintOf: hintOf('cardinality'),
      options: [
        { value: 'first', label: 'первая' },
        { value: 'all', label: 'все (пересобирает форму)' },
      ],
    }),
    demoSelect({
      key: 'markup',
      label: 'Политика разметки адаптера',
      url: false,
      jsOnly,
      defaultValue: 'default',
      hintOf: hintOf('markup'),
      options: [
        { value: 'default', label: 'умолчания' },
        { value: 'custom', label: 'свои' },
      ],
    }),
    demoSelect({
      key: 'parallel',
      label: 'Параллельные отправки',
      url: false,
      jsOnly,
      defaultValue: 'block',
      hintOf: hintOf('parallel'),
      options: [
        { value: 'block', label: 'блокировать' },
        { value: 'replace', label: 'заменять' },
        { value: 'queue', label: 'очередь' },
      ],
    }),
    demoSelect({
      key: 'answer',
      label: 'Ответ сервера',
      url: false,
      jsOnly,
      defaultValue: 'accept',
      hintOf: hintOf('answer'),
      hint: 'что сервер ответит на отправку (поле в форме скрытое)',
      options: [
        { value: 'accept', label: 'принято' },
        { value: 'redirect', label: 'переход' },
        { value: 'queued', label: 'в очереди' },
        { value: 'unknown', label: 'неизвестно' },
      ],
    }),
    demoDivider('Расширение на лету — на отдельном реестре'),
    demoToggle({
      key: 'with_type',
      label: 'Тип значения rating',
      url: false,
      jsOnly,
      defaultValue: false,
      hint: 'регистрирует свой тип: поле оценки получает range вместо числа',
    }),
    demoToggle({
      key: 'described',
      label: 'Правило «шестизначный код» — с описанием',
      url: false,
      jsOnly,
      defaultValue: false,
      hint: 'с описанием правило даёт атрибут pattern',
    }),
    demoDivider('Чужая служба: нормализация до обработчика'),
    demoSelect({
      key: 'sample',
      label: 'Образец чужой службы',
      url: false,
      jsOnly,
      defaultValue: 'поле и код известны',
      options: Object.keys(PSP_SAMPLES).map((k) => ({ value: k, label: k })),
    }),
  ],
})
