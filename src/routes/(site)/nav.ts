import type { NavItem } from '#components/shell/index.js'

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Главная' },
  { to: '/modals', label: 'Модалки' },
  { to: '/paginator', label: 'Пагинатор' },
  { to: '/form', label: 'Формы' },
  { to: '/fields', label: 'Поля' },
  { to: '/steps', label: 'Шаги' },
  { to: '/db-demo', label: 'База данных' },
  { to: '/cards/1', label: 'Карточка #1' },
  { to: '/cycle', label: 'Cycle' },
  { to: '/spike', label: 'Spike' },
]
