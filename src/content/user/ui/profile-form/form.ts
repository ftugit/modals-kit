// Описание встраиваемой формы профиля (`profileForm`): никнейм + файл картинки
// (`File | null`) + флаг явного удаления текущей картинки. Работает идентично
// с JS и без JS без передачи `base64`-строк по сети.
//
// Поле — обычный `file`: никакого отдельного типа и никакой отдельной защиты.
// Содержимое судит общее правило `image` (`extend.ts`), вид и сжатие включает
// страница опциями `Field`. Единственное, что задаёт профиль, — приёмлемые
// типы и предел исходника.
import { check, defineForm, field, v } from '#lib/form/index.js'
import { IMAGE_MIME_TYPES } from '#components/form/image.js'

/** Предел исходника до приведения: «потолок возможности», а не бюджет формы. */
export const IMAGE_RAW_MAX_BYTES = 8 * 1024 * 1024

export const PROFILE_FORM_ID = 'user-profile'

export const profileForm = defineForm({
  id: PROFILE_FORM_ID,
  revision: 3,
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
    // Картинка профиля — обычное поле файла по общим правилам: ни своего типа,
    // ни своей проверки. Вид (`preview`) и сжатие (`photoConvert={specAvatar}`)
    // включает страница; сервер приводит файл теми же параметрами без JS.
    photo: field.file({
      label: 'Аватар',
      validate: [v.accept([...IMAGE_MIME_TYPES]), v.maxSize(IMAGE_RAW_MAX_BYTES), check('image')],
    }),
    remove_photo: field.checkbox({
      label: 'Удалить текущее фото',
      defaultValue: false,
    }),
  },
})
