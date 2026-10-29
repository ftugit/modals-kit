import { defineForm, field, v } from '#lib/form/index.js'
import { USER_MESSAGES } from '#content/user/messages.js'

export const STORAGE_SERVER_FORM_ID = 'storage-server-admin'

export const storageServerForm = defineForm({
  id: STORAGE_SERVER_FORM_ID,
  revision: 1,
  messages: USER_MESSAGES,
  actions: [
    { id: 'save', label: 'Проверить и сохранить', validate: 'full' },
    { id: 'delete', label: 'Удалить', validate: 'none' },
  ],
  fields: {
    server_id: field.hidden({ defaultValue: '' }),
    slot: field.text({
      label: 'Имя слота сервера',
      placeholder: 'Например, s3_main или webdav_backup',
      help: 'Строчная латиница, цифры, «_», «-» (до 24 символов, кроме зарезервированных local_dev, local, memory, auto).',
      validate: [v.maxLength(24)],
    }),
    url: field.password({
      label: 'Ссылка подключения (DSN s3:// или webdav://)',
      placeholder: 's3://key:secret@host/bucket/prefix или webdav://user:pass@host/dir',
      help: 'Шифруется AUTH_SEAL_SECRET в БД (sealed_config). При редактировании пустое поле сохраняет прежний URL.',
      validate: [v.maxLength(2048)],
    }),
    encryption_key: field.password({
      label: 'Ключ потокового шифрования файлов (необязательно)',
      placeholder: 'Парольная фраза для прозрачного AES-256-GCM (64 КБ блоки + Range)',
      validate: [v.maxLength(256)],
    }),
    clear_encryption_key: field.checkbox({
      label: 'Сбросить ранее заданный ключ шифрования файлов',
      defaultValue: false,
    }),
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
    priority: field.text({
      label: 'Приоритет записи (0–10000, меньше — выше приоритет)',
      defaultValue: '100',
      validate: [v.required(), v.maxLength(6)],
    }),
    allow_split: field.checkbox({
      label: 'Разрешить хранение частей больших файлов (allowSplit)',
      defaultValue: true,
    }),
    read_only: field.checkbox({
      label: 'Только чтение (readOnly — исключить из пула записи)',
      defaultValue: false,
    }),
  },
})
