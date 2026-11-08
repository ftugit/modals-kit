// Описание поиска списка. Одно на все пагинаторы: имя списка и адрес носителя
// приходят скрытыми полями, не из тела как схема. Поле запроса — `q`, не
// адресный ключ: адрес пишет адаптер после POST.
import { defineForm, field, v } from '#lib/form/index.js'

export const PAGINATOR_SEARCH_FORM_ID = 'paginator-search'
export const PAGINATOR_SEARCH_MAX = 120

export const paginatorSearchForm = defineForm({
  id: PAGINATOR_SEARCH_FORM_ID,
  revision: 1,
  messages: {
    'search.no-address': 'У этого списка нет адреса для применения без JS.',
  },
  fields: {
    q: field.search({
      label: 'Поиск',
      validate: [v.maxLength(PAGINATOR_SEARCH_MAX)],
    }),
    paginator: field.hidden({}),
    page_param: field.hidden({}),
    from: field.hidden({}),
  },
})
