// Описание встраиваемой формы профиля (`profileForm`): никнейм + файл картинки
// (`File | null`) + флаг явного удаления текущей картинки. Работает идентично
// с JS и без JS без передачи `base64`-строк по сети.
//
// Поле — обычный `file`: никакого отдельного типа и никакой отдельной защиты.
// Содержимое судит общее правило `image` (`extend.ts`), вид и сжатие включает
// страница опциями `Field`. Профиль задаёт только предел файла и требование
// совпадения со спекой: сервер картинку НЕ приводит (см. `avatar-spec`).
import { check, defineForm, FILE_BUDGET_RESERVE, field, v } from '#lib/form/index.js'
import { IMAGE_MIME_TYPES } from '#components/form/image.js'
import { createUserChecks } from '../../checks.js'
import { AUTH_MESSAGES, PERMISSIONS_MESSAGES, PROFILE_MESSAGES } from '../../messages.js'
import { specAvatar } from '../../spec-avatar.js'

/**
 * Предел файла — вес готового кадра, а не исходника: на сервере конвертации
 * нет, поэтому прийти должен уже приведённый файл. С JS его готовит
 * `photoConvert={specAvatar}`; без JS такой файл и отправляют.
 */
export const IMAGE_RAW_MAX_BYTES = specAvatar.maxBytes

export const PROFILE_FORM_ID = 'user-profile'

export const profileForm = defineForm({
  id: PROFILE_FORM_ID,
  revision: 5,
  budget: IMAGE_RAW_MAX_BYTES + FILE_BUDGET_RESERVE,
  checks: createUserChecks(),
  // Доменные тексты — общий словарь модуля: отказы сессии (`auth.*`) и профиля
  // (`profile.*`, `image.*`) звучат одинаково во всех его формах.
  messages: { ...AUTH_MESSAGES, ...PROFILE_MESSAGES, ...PERMISSIONS_MESSAGES },
  actions: [{ id: 'profile', label: 'Сохранить профиль', validate: 'full' }],
  fields: {
    nickname: field.text({
      label: 'Никнейм',
      placeholder: 'необязательно',
      validate: [v.minLength(2), v.maxLength(32), check('nickname-forbidden')],
    }),
    // Картинка профиля — обычное поле файла по общим правилам: ни своего типа,
    // ни своей проверки. Вид (`preview`) и приведение (`photoConvert={specAvatar}`)
    // включает страница. Сервер не конвертирует: `avatar-spec` требует, чтобы
    // файл уже совпал со спекой (формат, кадр, вес).
    photo: field.file({
      label: 'Аватар',
      validate: [
        v.accept([...IMAGE_MIME_TYPES]),
        v.maxSize(IMAGE_RAW_MAX_BYTES),
        check('image'),
        check('avatar-spec'),
      ],
    }),
    remove_photo: field.checkbox({
      label: 'Удалить текущее фото',
      defaultValue: false,
    }),
    /**
     * Чей профиль правим: пусто — свой, иначе id аккаунта. Значение приходит из
     * разметки (админская поверхность), а не из адреса, поэтому проверяется на
     * сервере: править чужое разрешает только право `profile.edit`/`admin`.
     */
    subject: field.hidden({ label: 'Аккаунт' }),
  },
})
