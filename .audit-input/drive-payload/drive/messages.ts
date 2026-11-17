/**
 * Тексты домена «Диска» — один словарь на модель, сервисы и формы.
 *
 * Коды — это `drive.<область>-<причина>`; их отдают `checks.ts`,
 * `service/access.ts` и `service/query.ts`, а формулировки живут только здесь.
 * UI берёт строку через `driveMessage(code)` и не собирает фразы сам.
 */

export const DRIVE_MESSAGES: Record<string, string> = {
  // Имя узла (правило `#core/lib/drive/names`).
  'drive.name-empty': 'Имя не может быть пустым',
  'drive.name-too-long': 'Имя длиннее 255 символов',
  'drive.name-forbidden-char': 'В имени нельзя использовать «/», «\\» и управляющие символы',
  'drive.name-dot': 'Имя «.» или «..» занято самой папкой',
  'drive.name-reserved': 'Это имя зарезервировано системой (CON, NUL, LPT1, …)',
  'drive.name-taken': 'Файл или папка с таким именем уже есть в этой папке',

  // Узел и его вид.
  'drive.not-found': 'Файл или папка не найдены',
  'drive.forbidden': 'Недостаточно прав для этого действия',
  'drive.not-folder': 'Этот элемент — не папка',
  'drive.not-file': 'Этот элемент — не файл',
  'drive.kind-invalid': 'Вид узла: только «папка» или «файл»',
  'drive.file-id-missing': 'У файла нет байтового хранилища',
  'drive.file-id-unexpected': 'У папки не может быть байтового хранилища',
  'drive.size-invalid': 'Размер должен быть целым неотрицательным числом',

  // Родитель и перемещение.
  'drive.parent-not-folder': 'Переносить можно только в папку',
  'drive.parent-foreign': 'Нельзя скопировать элемент в чужой диск',
  'drive.parent-trashed': 'Папка назначения лежит в корзине',
  'drive.trashed-target': 'Папка назначения лежит в корзине',
  'drive.move-self': 'Нельзя перенести папку в саму себя',
  'drive.move-not-folder': 'Переносить можно только в папку',
  'drive.move-foreign-owner': 'Нельзя перенести элемент в чужой диск',
  'drive.move-trashed-target': 'Папка назначения лежит в корзине',
  'drive.move-cycle': 'Нельзя перенести папку внутрь её же подпапки',
  'drive.too-deep': 'Слишком глубокая вложенность папок',

  // Доступ.
  'drive.share-role-invalid': 'Роль доступа: только «просмотр» или «редактирование»',
  'drive.share-self': 'Себе доступ выдавать не нужно — вы владелец',
  'drive.trashed': 'Элемент уже в корзине',
  'drive.not-trashed': 'Элемент не в корзине — удалить навсегда можно только оттуда',
  'drive.storage-unavailable': 'Хранилище файлов недоступно — попробуйте позже',
  'drive.storage-readonly': 'Хранилище файлов не принимает записи',
  'drive.upload-empty': 'Файл пустой — загружать нечего',
  'drive.dav-label-invalid': 'Название пароля: от 1 до 80 символов',
  'drive.dav-disabled': 'Пароли WebDAV выключены: на сервере нет ключа подписи',
  'drive.dav-parent-missing': 'Папка назначения не найдена (409 Conflict)',
  'drive.dav-restore-failed': 'Не удалось выполнить операцию WebDAV',
  'drive.share-missing': 'Доступ не найден',
  'drive.share-exists': 'Доступ этому аккаунту уже выдан',

  // Квота.
  'drive.quota-over': 'Не хватает места: файл больше остатка квоты',
  'drive.quota-invalid': 'Размер квоты или файла некорректен',
}

/** Строка словаря по коду; неизвестный код показывается как есть. */
export function driveMessage(code: string): string {
  return DRIVE_MESSAGES[code] ?? code
}

/** Нарушение поля в форме ресурса (`checks` модели). */
export interface DriveIssue {
  readonly field: string
  readonly code: string
  readonly message: string
}

/** Нарушение поля с готовым текстом словаря. */
export function driveIssue(field: string, code: string): DriveIssue {
  return { field, code, message: driveMessage(code) }
}
