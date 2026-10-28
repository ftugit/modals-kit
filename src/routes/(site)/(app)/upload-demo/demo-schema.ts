/**
 * Схема универсальной демо-панели `/upload-demo` — только данные (без SvelteKit и `.svelte`),
 * проверяется при сборке скан-тестом `src/components/demo/schemas.test.ts`.
 */
import {
  defineDemoPanel,
  demoDivider,
  demoSelect,
  demoToggle,
} from '#components/demo/define.js'
import type { DemoOption, DemoValues } from '#components/demo/types.js'

export type UploadServerTarget = string
export type UploadAcceptMode = 'any' | 'images' | 'pdf_zip'
export type UploadMaxMb = '200' | '10' | '1'
export type UploadAclMode = 'allow' | 'deny_403' | 'expired_422'

export type UploadDemoValues = {
  server: UploadServerTarget
  integrity: boolean
  max_mb: UploadMaxMb
  accept: UploadAcceptMode
  multiple: boolean
  acl: UploadAclMode
}

export interface UploadVaultServerOption {
  readonly id: string
  readonly summary: string
}

const HINTS: Record<string, Record<string, string>> = {
  server: {
    local: 'поток пишется на локальный диск через .part -> rename',
    memory: 'поток сохраняется в оперативном драйвере memoryDriver процесса',
    auto: 'автовыбор первого доступного сервера по свободным лимитам и readOnly',
  },
  max_mb: {
    '200': 'до 200 МБ на файл (выше лимита HTTP-тела Vercel 4.5 МБ)',
    '10': 'до 10 МБ на файл: файл крупнее отсекается на Кадре 0 (0 байт по сети)',
    '1': 'до 1 МБ на файл: удобно проверить мгновенный отказ валидатора v.maxSize',
  },
  accept: {
    any: 'принимаются любые файлы (с защитой от маскировки активной разметки)',
    images: 'v.accept(["image/png","image/jpeg","image/webp"]) + серверный imageCheck по шапке',
    pdf_zip: 'v.accept(["application/pdf","application/zip",".pdf",".zip"]) + сверка magic bytes',
  },
  acl: {
    allow: 'ранний гейт authorize пропускает запрос',
    deny_403: 'authorize режет запрос кодом 403 на Кадре 0 ДО чтения 0 байтов файла',
    expired_422: 'authorize возвращает 422 auth.expired на Кадре 0 ДО чтения 0 байтов файла',
  },
}

const hintOf = (key: keyof UploadDemoValues) => (values: DemoValues) => {
  const val = String(values[key])
  const known = HINTS[key]?.[val]
  if (known) return known
  if (key === 'server') {
    return `поток льётся напрямую в S3-сервер «${val}» из зашифрованного куки-сейфа`
  }
  return undefined
}

export function createUploadDemoPanelSchema(
  vaultServers: readonly UploadVaultServerOption[] = [],
) {
  const serverOptions: DemoOption[] = [
    { value: 'local', label: 'local (диск)' },
    { value: 'memory', label: 'memory (ОЗУ)' },
    { value: 'auto', label: 'auto (по свободным лимитам)' },
    ...vaultServers.map((s) => ({
      value: s.id,
      label: `${s.id} (${s.summary})`,
    })),
  ]

  return defineDemoPanel<UploadDemoValues>({
    id: 'upload-demo',
    action: '/upload-demo',
    fields: [
      demoDivider('Хранилище и защита потока'),
      demoSelect({
        key: 'server',
        label: 'Хранилище назначения',
        defaultValue: 'local',
        url: { omitWhenDefault: true },
        hintOf: hintOf('server'),
        options: serverOptions,
      }),
      demoToggle({
        key: 'integrity',
        label: 'Солёная подпись потока (HMAC-SHA-256)',
        defaultValue: true,
        url: { omitWhenDefault: true },
        hint: 'одноразовая 32-байтная соль на отдельную загрузку',
      }),

      demoDivider('Валидаторы и ранний ACL (Кадр 0)'),
      demoSelect({
        key: 'max_mb',
        label: 'Лимит валидатора v.maxSize',
        defaultValue: '200',
        url: { omitWhenDefault: true },
        hintOf: hintOf('max_mb'),
        options: [
          { value: '200', label: '200 МБ' },
          { value: '10', label: '10 МБ' },
          { value: '1', label: '1 МБ' },
        ],
      }),
      demoSelect({
        key: 'accept',
        label: 'Тип файла (v.accept + сигнатура)',
        defaultValue: 'any',
        url: { omitWhenDefault: true },
        hintOf: hintOf('accept'),
        options: [
          { value: 'any', label: 'Любой формат' },
          { value: 'images', label: 'Картинки + image()' },
          { value: 'pdf_zip', label: 'PDF / ZIP + magic' },
        ],
      }),
      demoToggle({
        key: 'multiple',
        label: 'Пакетная загрузка (до 3 файлов, v.maxCount)',
        defaultValue: false,
        url: { omitWhenDefault: true },
      }),
      demoSelect({
        key: 'acl',
        label: 'Симуляция authorize на Кадре 0',
        defaultValue: 'allow',
        url: { omitWhenDefault: true },
        hintOf: hintOf('acl'),
        options: [
          { value: 'allow', label: 'Разрешено' },
          { value: 'deny_403', label: 'Отказ 403 Forbidden' },
          { value: 'expired_422', label: '422 auth.expired' },
        ],
      }),
    ],
  })
}

export const demoPanelSchema = createUploadDemoPanelSchema()
