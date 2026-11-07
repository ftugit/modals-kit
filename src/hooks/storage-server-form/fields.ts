import { field, v } from '#lib/form/index.js'

export interface StorageServerFieldOptions {
  /** Поле `priority` — только пул БД. В куки-сейфе слот перезаписывается по имени. */
  withPriority: boolean
  /**
   * Правка существующей записи пула: скрытый `server_id` и
   * `clear_encryption_key`. В сейфе слот перезаписывается по имени, этих полей нет.
   */
  allowEditExisting: boolean
}

/** Поля сервера S3 / WebDAV. Одинаковые имена у пула БД и куки-сейфа. */
export function storageServerFields(options: StorageServerFieldOptions) {
  const urlHelp = options.allowEditExisting
    ? 'Шифруется и не возвращается в HTML. При редактировании пустое поле сохраняет прежний URL.'
    : 'Шифруется в HttpOnly-куке и никогда не возвращается в HTML.'
  const keyHelp = options.allowEditExisting
    ? 'Парольная фраза для прозрачного AES-256-GCM. Пустое поле при редактировании сохраняет прежний ключ.'
    : 'Парольная фраза для прозрачного AES-256-GCM (64 КБ блоки + Range).'

  return {
    ...(options.allowEditExisting
      ? { server_id: field.hidden({ defaultValue: '' }) }
      : {}),
    slot: field.text({
      label: 'Имя слота сервера',
      placeholder: 'Например, s3_main или webdav_backup',
      help: 'Строчная латиница, цифры, «_», «-» (до 24 символов, кроме зарезервированных local, local_dev, memory, auto).',
      validate: [v.maxLength(24)],
    }),
    url: field.password({
      label: 'Ссылка подключения (DSN s3:// или webdav://)',
      placeholder: 's3://key:secret@host/bucket/prefix или webdav://user:pass@host/dir',
      help: urlHelp,
      validate: [v.maxLength(2048)],
    }),
    encryption_key: field.password({
      label: 'Ключ потокового шифрования файлов (необязательно)',
      placeholder: 'Парольная фраза для прозрачного AES-256-GCM',
      help: keyHelp,
      validate: [v.maxLength(256)],
    }),
    ...(options.allowEditExisting
      ? {
          clear_encryption_key: field.checkbox({
            label: 'Сбросить ранее заданный ключ шифрования файлов',
            defaultValue: false,
          }),
        }
      : {}),
    storage_mb: field.text({
      label: 'Общий лимит хранилища (МБ)',
      defaultValue: '5120',
      validate: [v.required(), v.maxLength(10)],
    }),
    file_mb: field.text({
      label: 'Лимит одного файла (МБ)',
      defaultValue: '512',
      validate: [v.required(), v.maxLength(10)],
    }),
    ...(options.withPriority
      ? {
          priority: field.text({
            label: 'Приоритет записи (0–10000, меньше — выше приоритет)',
            defaultValue: '100',
            validate: [v.required(), v.maxLength(6)],
          }),
        }
      : {}),
    allow_split: field.checkbox({
      label: 'Разрешить хранение частей больших файлов (allowSplit)',
      defaultValue: true,
    }),
    read_only: field.checkbox({
      label: 'Только чтение (readOnly — исключить из пула записи)',
      defaultValue: false,
    }),
  }
}
