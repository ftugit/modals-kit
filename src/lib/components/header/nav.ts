export interface NavItem {
  to: string
  label: string
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Главная' },
  { to: '/modals', label: 'Модалки' },
  { to: '/cards/1', label: 'Карточка #1' },
  { to: '/cycle', label: 'Cycle' },
  { to: '/spike', label: 'Spike' },
]
