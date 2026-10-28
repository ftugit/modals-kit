/**
 * Тексты-заглушки профиля: что показываем вместо отсутствующих данных.
 *
 * Единственное место этих строк (по образцу `spec-avatar.ts`): компонент
 * чтения профиля, экран «профиль не создан», меню и строка seed-списка
 * берут тексты отсюда, а не держат свои литералы — иначе одна и та же
 * мысль («ника нет») расходится по экранам разными словами.
 */
export interface SpecProfile {
  /** Никнейма нет (профиль есть, поле пусто) или профиля нет вовсе. */
  readonly nicknameMissing: string
  /** Заголовок состояния «профиль не создан». */
  readonly notCreatedTitle: string
  /** Пояснение состояния «профиль не создан». */
  readonly notCreatedText: string
  /** Аватара нет: подпись-заглушка рядом с инициалом. */
  readonly avatarMissing: string
  /** Заголовок блока приватности в своём профиле. */
  readonly privacyTitle: string
  /** Подписи уровней видимости (`all`/`users`/`nobody`) — человеку, одной строкой. */
  readonly privacyLevels: Readonly<Record<'all' | 'users' | 'nobody', string>>
}

/** Тексты профиля по умолчанию. */
export const specProfile: SpecProfile = {
  nicknameMissing: 'Нет никнейма',
  notCreatedTitle: 'Профиль не создан',
  notCreatedText: 'Пользователь пока не заполнил профиль: никнейм и аватар появятся здесь после первого заполнения.',
  avatarMissing: 'Аватар не загружен',
  privacyTitle: 'Кто видит ваш профиль',
  privacyLevels: {
    all: 'Все, включая гостей',
    users: 'Только пользователи',
    nobody: 'Никто, только я и администрация',
  },
}
