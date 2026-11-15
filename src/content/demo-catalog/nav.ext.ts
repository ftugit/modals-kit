import type { Path } from '$app/types'
import type { NavItem } from '#components/shell/index.js'
import type { ModuleHomeCard, NavModuleExtension } from '#hooks/module-ext.js'
import { kitRoute } from '#lib/address/sveltekit.js'

const fieldsRoute = kitRoute('/fields')
const stepsRoute = kitRoute('/steps')
const cardRoute = kitRoute('/(site)/(app)/cards/[id]', { dynamic: true, id: '/cards/[id]' })

const STATIC_DEMO_ITEMS = [
  { to: '/modals', label: 'Модалки' },
  { to: '/paginator', label: 'Пагинатор' },
  { to: '/form', label: 'Формы' },
  { to: fieldsRoute.href(), label: 'Поля' },
  { to: stepsRoute.href(), label: 'Шаги' },
  { to: '/db-demo', label: 'База данных' },
  { to: '/upload-demo', label: 'Загрузка файлов' },
  { to: '/cycle', label: 'Cycle' },
  { to: '/spike', label: 'Spike' },
] satisfies readonly (NavItem & { readonly to: Path })[]

const DEMO_CARDS: readonly ModuleHomeCard[] = [
  {
    href: '/modals',
    title: 'Модальные окна',
    text: 'Стек окон, URL-состояние, загрузка и полноэкранная версия карточки.',
  },
  {
    href: '/paginator',
    title: 'Пагинатор',
    text: 'Headless-пагинация, URL/localStorage персист, скролл-сентинелы, якоря и раскладки.',
    devHref: '/paginator?selectTrace=1&page.src=animes',
    devLabel: 'Открыть Select trace (dev)',
  },
  {
    href: '/form',
    title: 'Формы',
    text: 'Формы со строгой валидацией, генерацией полей и серверными слоями.',
  },
  {
    href: '/fields',
    title: 'Конструктор полей',
    text: 'Поле формы field.fields: пользователь собирает поля с правилами, сохранённый набор снова становится формой записи.',
  },
  {
    href: '/steps',
    title: 'Шаги',
    text: 'Универсальный хост шагов: url/local/hybrid, произвольное содержимое и адрес через бронь ключей.',
  },
  {
    href: '/db-demo',
    title: 'База данных',
    text:
      'Слой #lib/db внутри SvelteKit: миграции, ресурсы с политиками, form actions, '
      + 'страницы и курсоры — на PGlite в памяти и на pg через DATABASE_URL.',
  },
  {
    href: '/cycle',
    title: 'Полный цикл',
    text: 'Объявление → вызов с параметрами → цепочка → адрес → Назад: цикл жизни записи без хоста.',
  },
  {
    href: '/spike',
    title: 'Спайк истории',
    text: 'Песочница модели истории: ?modal= и transient в page.state, сырой history.state.',
  },
]

export const navExtension: NavModuleExtension = {
  order: 100,
  navItems: [
    ...STATIC_DEMO_ITEMS,
    { to: cardRoute.href({ id: '1' }), label: 'Карточка #1' },
  ],
  homeCards: DEMO_CARDS,
}
