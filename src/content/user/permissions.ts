/**
 * Права модуля пользователя — каталог конкретных действий.
 *
 * Механизм в `lib/db` один и тот же: `policy.roles([...])` и `ownerOrRoles`
 * сравнивают строки с `ctx.principal.roles` через `some` — то есть ИЛИ.
 * Поэтому «роль» и «право» технически неразличимы, и здесь лежат именно
 * права: строка = одно действие. Ни иерархии, ни наследования, ни `*`.
 *
 * `admin` — такое же имя в списке, а не надстройка: он открывает операцию
 * только там, где вписан рядом с правом, например
 * `policy.ownerOrRoles('auth_id', ['admin', 'profile.read'])`.
 *
 * Тексты (`title`, `description`) — для экрана выдачи прав: что человек
 * получит, если включить галочку. Это не тексты ошибок — те в `messages.ts`.
 */

/** Как право показывать: короткое имя и что оно разрешает. */
export interface PermissionInfo {
  /** Название для списка — существительное, без «может». */
  readonly title: string
  /** Что именно открывает право; одна строка, без перечисления кода. */
  readonly description: string
}

/**
 * Каталог прав. Ключ — значение, которое лежит в `principal.roles` и в
 * правилах моделей; менять его нельзя без миграции выданных прав.
 */
export const PERMISSIONS = {
  'account.read': {
    title: 'Чтение аккаунтов',
    description: 'Видеть любой аккаунт: seed, блокировки и дату заявки на удаление. Без права — только свой.',
  },
  'account.write': {
    title: 'Правка аккаунтов',
    description: 'Менять служебные поля любого аккаунта, включая seed.',
  },
  'account.delete': {
    title: 'Удаление аккаунтов',
    description: 'Удалять и восстанавливать любой аккаунт, включая строки с заявкой на удаление.',
  },
  'account.block': {
    title: 'Блокировка аккаунтов',
    description: 'Ставить и снимать блокировки любого аккаунта: полный бан и ограничения по сферам.',
  },
  'profile.read': {
    title: 'Чтение профилей',
    description: 'Видеть никнейм и аватар любого пользователя, а не только свой.',
  },
  'profile.write': {
    title: 'Правка профилей',
    description: 'Менять никнейм и аватар любому пользователю.',
  },
  'profile.delete': {
    title: 'Удаление профилей',
    description: 'Удалять профиль любого пользователя, не трогая сам аккаунт.',
  },
  'session.read': {
    title: 'Чтение сессий',
    description: 'Видеть устройства и историю входов любого аккаунта.',
  },
  'session.revoke': {
    title: 'Отзыв сессий',
    description: 'Завершать сеансы на устройствах любого аккаунта, в том числе «выйти везде».',
  },
  'deleted.read': {
    title: 'Чтение удалённого',
    description: 'Показывать удалённые записи рядом с живыми: без этого они скрыты у всех.',
  },
  'permissions.write': {
    title: 'Управление правами',
    description: 'Выдавать и снимать права другим аккаунтам, включая администратора.',
  },
} as const satisfies Record<string, PermissionInfo>

/** Право — ключ каталога; именно эта строка лежит в `principal.roles`. */
export type Permission = keyof typeof PERMISSIONS

/**
 * Имя администратора. Сам по себе не открывает ничего: правило видит его,
 * только если `'admin'` перечислен в том же массиве, что и права.
 * Значение совпадает с тем, что уже стоит в правилах моделей модуля.
 */
export const ADMIN_ROLE = 'admin'

/** Как показывать саму роль администратора в том же списке. */
export const ADMIN_INFO: PermissionInfo = {
  title: 'Администратор',
  description:
    'Все права сразу. Действует только там, где вписан в правило рядом с конкретным правом, — сам по себе ничего не открывает.',
}

/**
 * Полный набор прав — для кнопки «выдать всё». Раскрывается в конкретные
 * права при выдаче, чтобы по строке аккаунта было видно, что человек может.
 */
export const ADMIN_BUNDLE: readonly Permission[] = Object.keys(PERMISSIONS) as Permission[]

/** Группы для экрана выдачи: порядок и заголовки. Каждое право — ровно в одной. */
export const PERMISSION_GROUPS: readonly {
  readonly title: string
  readonly permissions: readonly Permission[]
}[] = [
  { title: 'Аккаунты', permissions: ['account.read', 'account.write', 'account.delete', 'account.block'] },
  { title: 'Профили', permissions: ['profile.read', 'profile.write', 'profile.delete'] },
  { title: 'Сессии', permissions: ['session.read', 'session.revoke'] },
  { title: 'Служебные', permissions: ['deleted.read', 'permissions.write'] },
]

/** Строка из `principal.roles` — известное право? */
export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value)
}

/** Текст для показа: у администратора свой, у права — из каталога. */
export function describeGrant(value: string): PermissionInfo | undefined {
  if (value === ADMIN_ROLE) return ADMIN_INFO
  return isPermission(value) ? PERMISSIONS[value] : undefined
}
