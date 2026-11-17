/**
 * Каталог сфер блокировок аккаунта — единая точка состава и текстов.
 *
 * Блокировка (`Blocked` в auth-строке) — запись истории: сфер может
 * быть несколько одновременно (накладываются друг на друга), у каждой
 * свой срок; истёкшая не действует и не показывается, но не стирается.
 * Что сфера значит, как называется и как описывается человеку, знает
 * только этот каталог: на нём строится select раздела блокировок
 * (этап 9), проверки возможности (удаление — этапы 6–7) и экраны.
 * По образцу `spec-profile.ts`/`permissions.ts`: тексты не размазаны
 * по компонентам.
 */
import type { Blocked } from './types.js'

/** Как сферу показывать: короткое имя и что она закрывает. */
export interface BlockScopeInfo {
  readonly title: string
  /** Что именно закрывает сфера; одна строка для select и экранов. */
  readonly description: string
}

/** Сферы блокировок: ключ — значение `Blocked.scope`, менять нельзя без миграции записей. */
export const BLOCK_SCOPES = {
  auth: {
    title: 'Аккаунт целиком',
    description: 'Вход закрыт полностью: ни войти, ни действовать сессиями.',
  },
  'profile.delete': {
    title: 'Удаление профиля',
    description: 'Профиль этого аккаунта нельзя удалить — ни владельцу, ни другим.',
  },
  'account.delete': {
    title: 'Удаление аккаунта',
    description: 'Seed-аккаунт нельзя удалить (заявка на удаление не пройдёт) — ни владельцу, ни другим.',
  },
} as const satisfies Record<string, BlockScopeInfo>

/** Сфера блокировки — ключ каталога. */
export type BlockScope = keyof typeof BLOCK_SCOPES

/** Известная сфера? (Записи истории могут нести сферы старше каталога.) */
export function isBlockScope(value: string): value is BlockScope {
  return Object.hasOwn(BLOCK_SCOPES, value)
}

/** Текст сферы для показа: у известной — из каталога, у исторической — сама строка. */
export function describeBlockScope(scope: string): BlockScopeInfo {
  return isBlockScope(scope) ? BLOCK_SCOPES[scope] : { title: scope, description: scope }
}

/** Активна ли запись сейчас: срок не задан или ещё не вышел. */
export function blockActive(b: Blocked, now: number): boolean {
  return b.until === undefined || b.until > now
}

/** Активный запрет по сфере: любая действующая запись этой сферы (их может быть несколько). */
export function activeBlock(list: readonly Blocked[] | undefined, scope: BlockScope, now: number): Blocked | undefined {
  return (list ?? []).find((b) => b.scope === scope && blockActive(b, now))
}

/**
 * Самая длинная активная полная блокировка: бессрочная длиннее любой
 * срочной, из срочных — с самым поздним окончанием. Её показывает
 * компонент авторизации, когда полных блокировок несколько.
 */
export function longestFullBlock(list: readonly Blocked[] | undefined, now: number): Blocked | undefined {
  let best: Blocked | undefined
  for (const b of list ?? []) {
    if (b.scope !== 'auth' || !blockActive(b, now)) continue
    if (!best || (b.until ?? Infinity) > (best.until ?? Infinity)) best = b
  }
  return best
}

/** Тексты раздела блокировок (этап 9) — единая точка, по образцу остальных спек. */
export const specBlocks = {
  title: 'Блокировки',
  addTitle: 'Наложить блокировку',
  scopeLabel: 'Что закрываем',
  reasonLabel: 'Причина',
  reasonHelp: 'Обязательно: причина видна владельцу и кругу управления.',
  reasonRequired: 'Укажите причину',
  foreverLabel: 'Навсегда',
  untilLabel: 'Действует до',
  durationLabel: 'Или на срок',
  durationUnits: [
    { value: 'minutes', label: 'минут' },
    { value: 'hours', label: 'часов' },
    { value: 'days', label: 'дней' },
    { value: 'weeks', label: 'недель' },
    { value: 'months', label: 'месяцев' },
    { value: 'years', label: 'лет' },
  ],
  addButton: 'Заблокировать',
  liftButton: 'Снять',
  activeTitle: 'Активные',
  historyTitle: 'История',
  empty: 'Блокировок нет',
  noActive: 'Активных блокировок нет',
  untilText: (until: number) => `до ${new Date(until).toLocaleString('ru-RU')}`,
  foreverText: 'бессрочно',
  byText: (by: string) => `наложил ${by}`,
  expiredText: 'истекла',
} as const
