/**
 * Тексты доменных ошибок модуля пользователя — один словарь на все его формы.
 *
 * Коды — `AuthErrorCode` (`error.ts`). Без текста форма покажет сам код
 * (`makeRenderer` → `return code`), поэтому `messages.test.ts` сверяет тип и
 * словарь: новый код без строки — красный тест.
 */
/** Ответы входа, продления и сессии — одинаковы для профиля и формы seed. */
export const AUTH_MESSAGES: Record<string, string> = {
  'auth.nonce-unknown': 'Время подтверждения истекло — попробуйте ещё раз',
  'auth.signature': 'Seed или подпись не сошлись — проверьте ввод',
  'auth.identity-unknown': 'Аккаунта с таким seed больше нет',
  'auth.token': 'Сессия повреждена — войдите заново',
  'auth.kid-unknown': 'Ключ сессии устарел — войдите заново',
  'auth.expired': 'Время сессии вышло — войдите заново',
  'auth.revoked': 'Сеанс завершён на этом устройстве',
  'auth.session-unknown': 'Сессия не найдена — войдите заново',
  'auth.blocked': 'Аккаунт заблокирован',
  'auth.disabled':
    'Вход выключен: на сервере не задан AUTH_SEAL_SECRET — сессии нечем запечатывать',
  'auth.delete-pending': 'Заявка на удаление ещё активна',
  'auth.deleted': 'Аккаунт удалён — его можно восстановить, пока seed не стёрт',
  'auth.confirm': 'Что-то пошло не так — попробуйте ещё раз',
  'auth.forbidden': 'Нужны права администратора',
  'profile.delete-blocked': 'Удаление профиля запрещено на этом аккаунте',
  'account.delete-blocked': 'Удаление seed-аккаунта запрещено на этом аккаунте',
}

/** Профиль: никнейм и картинка (`image.*` — общее правило файла-картинки). */
export const PROFILE_MESSAGES: Record<string, string> = {
  'profile.nickname-forbidden':
    'Такой никнейм нельзя: 2–32 знака, без служебных имён (admin, root, …)',
  'profile.photo-format': 'Это не картинка или формат не из разрешённых (jpeg, png, webp)',
  'profile.photo-size': 'Файл больше 20 КБ — картинку нужно уменьшить',
  'profile.photo-spec':
    'Картинка должна быть JPEG 200×200 не тяжелее 20 КБ. Включите скрипты — браузер приведёт её сам',
  'image.format': 'Это не картинка или формат не из разрешённых (jpeg, png, webp)',
  'image.dimensions': 'Разрешение картинки слишком велико — возьмите файл поменьше',
}

/** Выдача прав: кто и что может выдать (`admin.ts`). */
export const PERMISSIONS_MESSAGES: Record<string, string> = {
  'permissions.unknown': 'Такого права нет — укажите допустимый идентификатор права или роли',
  'permissions.self': 'Свои права менять нельзя — попросите другого администратора',
}

/** Настройки пользователя (`user.config` / `spec-config.ts`). */
export const CONFIG_MESSAGES: Record<string, string> = {
  'config.key-unknown': 'Неизвестный параметр настроек',
  'config.value-invalid': 'Недопустимое значение параметра настроек',
  'config.rule-forbidden': 'У вас нет прав на изменение этого параметра',
}

/** Боевое хранилище файлов и пул серверов (`STORAGE_ACL`). */
export const STORAGE_MESSAGES: Record<string, string> = {
  'storage.pool-empty': 'Хранилище файлов ещё не подключено администратором',
  'storage.unavailable': 'Не удалось обратиться к хранилищу файлов — попробуйте позже',
  'storage.slot-invalid': 'Имя слота: строчная латиница, цифры, «_» или «-» (до 24 символов)',
  'storage.slot-reserved': 'Это имя слота зарезервировано встроенным хранилищем',
  'storage.url-invalid': 'Укажите корректную ссылку хранилища s3://… или webdav://…',
  'storage.limits-invalid': 'Укажите целые квоты (1–1 048 576 МБ), где лимит файла не превышает общий объём',
  'storage.probe-failed': 'Проверка подключения к серверу не прошла: {detail}',
  'storage.not-found': 'Сервер хранилища не найден',
}

/** Всё доменное сразу: то, что формы модуля кладут в `messages`. */
export const USER_MESSAGES: Record<string, string> = {
  ...AUTH_MESSAGES,
  ...PROFILE_MESSAGES,
  ...PERMISSIONS_MESSAGES,
  ...CONFIG_MESSAGES,
  ...STORAGE_MESSAGES,
}
