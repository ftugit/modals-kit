// Описания форм модуля пользователя:
//   1. `seedForm` — универсальная форма доказательства владения `seed` по срезам
//      `formSteps` (`entry`, `register`, `restore`, `confirm`) + сервисные
//      программные интенты (`accept`, `logout`, `renew`, `challenge`).
//      Флаг авторизации решается строго на сервере по интенту (`login`/`restore`
//      открывают сессию гостю, `confirm` проверяет владение `seed` текущим
//      аккаунтом без перевыпуска сессии).
//   2. `profileForm` — встраиваемая форма профиля (`nickname` + файловое поле
//      `avatar` типа `photo` + `removeAvatar`). По сети передаётся только
//      бинарный `File` (`multipart/form-data`), никаких `base64`-строк.
import { check, defineForm, field, v } from '#lib/form/index.js'
import { photoImage } from '#lib/components/form/photo.js'
import { AVATAR_PHOTO_ID, PHOTO_RAW_MAX_BYTES, SERVER_PHOTO_FORMATS } from './checks.js'
import {
  PROFILE_FORM_ID,
  SEED_FORM_ID,
  SEED_FORM_REV,
  seedEnvelope,
  seedEnvelopeFields,
} from './envelope.js'

export { PROFILE_FORM_ID, SEED_FORM_ID, SEED_FORM_REV, seedEnvelope, seedEnvelopeFields }

/**
 * Универсальная форма доказательства владения `seed`: обслуживает как срезы
 * гостевой авторизации (`login`, `restore`), так и срез подтверждения владения
 * уже авторизованным пользователем (`confirm`) для критичных операций.
 */
export const seedForm = defineForm({
  id: SEED_FORM_ID,
  revision: SEED_FORM_REV,
  messages: {
    'auth.disabled': 'Вход выключен: на сервере не задан AUTH_SEAL_SECRET — сессии нечем запечатывать',
    'pattern': 'Это не seed: 43–44 знака — латиница, цифры, «-» и «_»',
    'auth.nonce-unknown': 'Время подтверждения истекло — попробуйте ещё раз',
    'auth.signature': 'Seed или подпись не сошлись — проверьте ввод',
    'auth.identity-unknown': 'Аккаунта с таким seed больше нет',
    'auth.token': 'Сессия повреждена — войдите заново',
    'auth.expired': 'Время сессии вышло — войдите заново',
    'auth.revoked': 'Сеанс завершён на этом устройстве',
    'auth.session-unknown': 'Сессия не найдена — войдите заново',
    'auth.blocked': 'Аккаунт заблокирован',
    'auth.delete-pending': 'Заявка на удаление ещё активна',
    'auth.deleted': 'Аккаунт удалён — его можно восстановить, пока seed не стёрт',
    'auth.confirm': 'Что-то пошло не так — попробуйте ещё раз',
  },
  actions: [
    { id: 'login', label: 'Войти', validate: 'full' },
    { id: 'restore', label: 'Восстановить аккаунт', validate: 'full' },
    // Повторное доказательство владения seed авторизованным пользователем
    // без перевыпуска сессии и кук.
    { id: 'confirm', label: 'Подтвердить владение', validate: 'full' },
    // Сервисные действия — программные отправки конверта без видимого поля seed.
    { id: 'accept', label: 'Принято', validate: 'partial', relax: ['required'] },
    { id: 'logout', label: 'Выйти', validate: 'partial', relax: ['required'] },
    { id: 'renew', label: 'Продлить', validate: 'partial', relax: ['required'] },
    { id: 'challenge', label: 'Свежий nonce', validate: 'partial', relax: ['required'] },
  ],
  fields: {
    seed: field.text({
      label: 'Seed',
      help: 'Единственный ключ от аккаунта — храните в менеджере секретов',
      validate: [v.required(), v.pattern({ source: '[A-Za-z0-9_-]{43,44}' })],
    }),
    nonce: field.hidden({ label: 'Nonce' }),
    signature: field.hidden({ label: 'Подпись' }),
  },
})

/**
 * Встраиваемая форма профиля: никнейм + бинарное фото (`File | null`) + флаг
 * явного удаления текущего аватара. Работает идентично с JS и без JS.
 */
export const profileForm = defineForm({
  id: PROFILE_FORM_ID,
  revision: 2,
  messages: {
    'profile.nickname-forbidden': 'Такой никнейм нельзя: 2–32 знака, без служебных имён (admin, root, …)',
    'profile.avatar-format': 'Это не картинка или формат не из разрешённых (jpeg, png, webp)',
    'profile.avatar-size': 'Картинка не сжимается до нужного веса — возьмите другую',
    'image.format': 'Это не картинка или формат не из разрешённых (jpeg, png, webp)',
    'image.dimensions': 'Разрешение картинки слишком велико — возьмите файл поменьше',
  },
  actions: [{ id: 'profile', label: 'Сохранить профиль', validate: 'full' }],
  fields: {
    nickname: field.text({
      label: 'Никнейм',
      placeholder: 'необязательно',
      validate: [v.minLength(2), v.maxLength(32), check('nickname-forbidden')],
    }),
    avatar: field.photo({
      label: 'Аватар',
      variant: 'preview',
      validate: [
        v.accept(SERVER_PHOTO_FORMATS),
        v.maxSize(PHOTO_RAW_MAX_BYTES),
        photoImage(AVATAR_PHOTO_ID),
      ],
    }),
    remove_avatar: field.checkbox({
      label: 'Удалить текущее фото',
      defaultValue: false,
    }),
  },
})
