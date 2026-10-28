/**
 * Права модуля пользователя — каталог конкретных действий.
 *
 * Механизм в `lib/db` один и тот же: `policy.roles([...])` и `ownerOrRoles`
 * сравнивают строки с `ctx.principal.roles` через `some` — то есть ИЛИ.
 * Поэтому «роль» и «право» технически неразличимы, и здесь лежат именно
 * права: строка = одно действие над одной моделью.
 *
 * Три действия, не больше:
 * - `read` — видеть строки, включая удалённые (одна строка закрывает и
 *   `policy.select`, и `readDeleted`);
 * - `edit` — менять и удалять (затереть данные и удалить строку — одно и то
 *   же последствие, отдельного права нет);
 * - `create` — не право, а сервер: строки заводятся только кодом сервера,
 *   поэтому в каталоге его нет и выдать его нельзя.
 *
 * `admin` — отдельное имя в списке, а не надстройка над правами: оно
 * открывает операцию только там, где вписано рядом с правом, например
 * `policy.ownerOrRoles('auth_id', ['admin', 'profile.read'])`. По смыслу это
 * root: получил `admin` — получаешь всё, что перечислено в правилах вместе с
 * ним, отдельные права держать не нужно.
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
 *
 * Подключены сейчас (`schema.ts`, модель профиля) только `profile.read` и
 * `profile.edit`. Остальные — тот же набор для `auth` и `session`: правила
 * этих моделей пока перечисляют только `server`/`admin` и примут права
 * отдельным шагом, чтобы ключи не менялись дважды.
 */
export const PERMISSIONS = {
  'account.read': {
    title: 'Чтение аккаунтов',
    description: 'Видеть любой аккаунт: seed, блокировки, заявку на удаление — вместе с удалёнными строками.',
  },
  'account.edit': {
    title: 'Правка аккаунтов',
    description: 'Менять служебные поля любого аккаунта, ставить блокировки, удалять и восстанавливать.',
  },
  'profile.read': {
    title: 'Чтение профилей',
    description: 'Видеть никнейм и аватар любого пользователя, а не только свой.',
  },
  'profile.edit': {
    title: 'Правка профилей',
    description: 'Менять и удалять профиль любого пользователя.',
  },
  'session.read': {
    title: 'Чтение сессий',
    description: 'Видеть устройства и историю входов любого аккаунта, включая завершённые.',
  },
  'session.edit': {
    title: 'Правка сессий',
    description: 'Завершать сеансы на устройствах любого аккаунта, в том числе «выйти везде».',
  },
  'config.read': {
    title: 'Чтение конфига',
    description: 'Видеть ключи конфига и их значения: умолчания и закреплённые за пользователями.',
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
 * Роль администратора это не заменяет: она вписывается в правила отдельно.
 */
export const ADMIN_BUNDLE: readonly Permission[] = Object.keys(PERMISSIONS) as Permission[]

/** Группы для экрана выдачи: порядок и заголовки. Каждое право — ровно в одной. */
export const PERMISSION_GROUPS: readonly {
  readonly title: string
  readonly permissions: readonly Permission[]
}[] = [
  { title: 'Аккаунты', permissions: ['account.read', 'account.edit'] },
  { title: 'Профили', permissions: ['profile.read', 'profile.edit'] },
  { title: 'Сессии', permissions: ['session.read', 'session.edit'] },
  { title: 'Конфиг', permissions: ['config.read'] },
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
