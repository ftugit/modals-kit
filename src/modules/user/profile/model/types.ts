/**
 * Типы профиля — контракт `base`: профиль участвует в токенах (`prof`),
 * порту `profiles` и конфиге видимости, поэтому базовый слой их объявляет.
 * Модуль профиля реэкспортирует — внешний адрес типов не меняется.
 */
export type {
  ProfileView,
  ProfileListView,
  VisibilityLevel,
  PublicProfileView,
  ProfileRead,
  ProfileRouteData,
  ProfileDeleteRouteData,
} from '#modules/user/base/model/types.js'
