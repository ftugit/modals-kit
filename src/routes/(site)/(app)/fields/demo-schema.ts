/**
 * Схема демо-панели `/fields` — ДАННЫЕ и только данные.
 *
 * У конструктора полей до сей поры не было ни одной опции: пределы набора
 * стояли в коде обеих сторон. Панель выносит их в адрес (`?limit=`), и
 * значение читают ОБЕ стороны из одного места — страница строит по нему
 * описание формы, сервер — приёмник запроса.
 *
 * Файл без SvelteKit и без `.svelte`: его импортирует скан-тест
 * (`src/components/demo/schemas.test.ts`) вне приложения.
 */
import { defineDemoPanel, demoSelect } from '#components/demo/define.js'
import { FIELD_LIMITS } from './forms'

export type FieldsDemoValues = { limit: string }

export const demoPanelSchema = defineDemoPanel<FieldsDemoValues>({
  id: 'fields-demo',
  action: '/fields',
  /**
   * Предел меняет описание формы — его строит сервер. Полная навигация, а не
   * мелкая запись: без загрузки данных страница осталась бы с прежним описанием.
   */
  load: true,
  fields: [
    demoSelect({
      key: 'limit',
      label: 'Сколько полей можно собрать',
      hint: 'Предел набора проверяют и браузер, и сервер — оба берут его из адреса',
      options: FIELD_LIMITS.map((n) => ({ value: String(n), label: String(n) })),
      defaultValue: '8',
      url: { omitWhenDefault: true },
    }),
  ],
})
