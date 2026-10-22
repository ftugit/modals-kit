// Описание встраиваемой формы профиля (`profileForm`): никнейм + бинарное фото
// (`File | null`) + флаг явного удаления текущего аватара. Работает идентично
// с JS и без JS без передачи `base64`-строк по сети.
import { check, defineForm, field, v } from '#lib/form/index.js'
import { photoImage } from '#lib/components/form/photo.js'
import { AVATAR_PHOTO_ID, PHOTO_RAW_MAX_BYTES, SERVER_PHOTO_FORMATS } from '../../checks.js'

export const PROFILE_FORM_ID = 'user-profile'

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
