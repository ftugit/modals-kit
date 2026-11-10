// Коды ошибок форм пользователей, не ключи адреса фильтров.
export const FILTER_ERROR = {
  range: 'filters.range', // source-schema-ok: код ошибки формы, не ключ фильтра
  size: 'filters.size', // source-schema-ok: код ошибки формы, не ключ фильтра
  value: 'filters.value', // source-schema-ok: код ошибки формы, не ключ фильтра
  noAddress: 'filters.no-address',
} as const

export const FILTER_MESSAGES = {
  [FILTER_ERROR.range]: 'Дата «с» позже даты «по» — поправьте диапазон',
  [FILTER_ERROR.size]: 'Элементов на страницу — целое число от 30 до 100',
  [FILTER_ERROR.value]: 'Такое значение фильтр не принимает',
  [FILTER_ERROR.noAddress]: 'У этого списка нет адреса для применения без JS.',
} as const
