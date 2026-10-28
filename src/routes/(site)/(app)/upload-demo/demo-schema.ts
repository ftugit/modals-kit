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
export type UploadWriteStrategy = 'priority' | 'most-free' | 'round-robin'
export type UploadAcceptMode = 'any' | 'images' | 'pdf_zip'
export type UploadMaxMb = '200' | '10' | '1'
export type UploadAclMode = 'allow' | 'deny_403' | 'expired_422'
export type DownloadServeMode = 'attachment' | 'inline'
export type DownloadRateMode = 'default' | '262144' | '65536' | '0'
export type DownloadConcurrencyMode =
  | 'default'
  | 'reject_1'
  | 'queue_1'
  | 'preempt_1'
  | '0'

export type UploadDemoValues = {
  server: UploadServerTarget
  write_strategy: UploadWriteStrategy
  stage_to_disk: boolean
  integrity: boolean
  dl_mode: DownloadServeMode
  dl_rate: DownloadRateMode
  dl_concurrency: DownloadConcurrencyMode
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
    auto: 'автовыбор сервера из пула по стратегии writeStrategy, лимитам и карантину cooldownMs',
    split_demo:
      'наглядная нарезка файлов > 512 КБ по двум зашифрованным шардам shard_a + shard_b (AES-256-GCM) с последующей склейкой при скачивании',
  },
  write_strategy: {
    priority: 'при auto берётся первый здоровый сервер из пула по порядку объявления',
    'most-free': 'при auto выбирается сервер с наибольшим свободным остатком байт в ledger',
    'round-robin': 'при auto серверы пула чередуются по кругу',
  },
  dl_mode: {
    attachment:
      'storage.serve(..., { download: filename }) — RFC 5987 Content-Disposition с оригинальным UTF-8 именем',
    inline:
      'storage.serve(..., { download: false }) — просмотр в браузере (активные HTML/SVG/JS всё равно принудительно изолируются в attachment + CSP sandbox)',
  },
  dl_rate: {
    default: 'используется настройка rate самого сервера (по умолчанию без ограничения)',
    '262144': 'шейпер полосы скачивания 256 КБ/с на поток',
    '65536': 'шейпер полосы скачивания 64 КБ/с (удобно наблюдать длительность и тест 2 потоков)',
    '0': 'rate: 0 — принудительно снимает лимит скорости сервера для этого скачивания',
  },
  dl_concurrency: {
    default: 'используется настройка concurrency самого сервера (без искусственного лимита)',
    reject_1: 'max: 1, mode: "reject" — второй одновременный поток скачивания мгновенно получает HTTP 429',
    queue_1: 'max: 1, mode: "queue" — второй поток ждёт завершения первого в очереди',
    preempt_1: 'max: 1, mode: "preempt" — новый поток скачивания вытесняет и обрывает предыдущий',
    '0': 'concurrency: 0 — принудительно снимает лимит потоков сервера на этот вызов',
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
    return `поток льётся напрямую в сервер «${val}» из зашифрованного куки-сейфа`
  }
  return undefined
}

export function createUploadDemoPanelSchema(
  vaultServers: readonly UploadVaultServerOption[] = [],
) {
  const serverOptions: DemoOption[] = [
    { value: 'local', label: 'local (диск)' },
    { value: 'memory', label: 'memory (ОЗУ)' },
    { value: 'auto', label: 'auto (пул серверов)' },
    { value: 'split_demo', label: 'split_demo (нарезка >512 КБ: shard_a + shard_b)' },
    ...vaultServers.map((s) => ({
      value: s.id,
      label: `${s.id} (${s.summary})`,
    })),
  ]

  return defineDemoPanel<UploadDemoValues>({
    id: 'upload-demo',
    action: '/upload-demo',
    fields: [
      demoDivider('Хранилище, нарезка и загрузка'),
      demoSelect({
        key: 'server',
        label: 'Хранилище назначения',
        defaultValue: 'local',
        url: { omitWhenDefault: true },
        hintOf: hintOf('server'),
        options: serverOptions,
      }),
      demoSelect({
        key: 'write_strategy',
        label: 'Стратегия пула при auto',
        defaultValue: 'priority',
        url: { omitWhenDefault: true },
        hintOf: hintOf('write_strategy'),
        options: [
          { value: 'priority', label: 'priority (по порядку)' },
          { value: 'most-free', label: 'most-free (больше свободного места)' },
          { value: 'round-robin', label: 'round-robin (по кругу)' },
        ],
      }),
      demoToggle({
        key: 'stage_to_disk',
        label: 'Дисковый спул stageToDisk (localSpool для split потока)',
        defaultValue: false,
        url: { omitWhenDefault: true },
        hint: 'сохраняет входящий поток во временный спул до раскладки кусков по серверам',
      }),
      demoToggle({
        key: 'integrity',
        label: 'Солёная подпись потока (HMAC-SHA-256)',
        defaultValue: true,
        url: { omitWhenDefault: true },
        hint: 'одноразовая 32-байтная соль на отдельную загрузку',
      }),

      demoDivider('Скачивание и раздача (storage.serve)'),
      demoSelect({
        key: 'dl_mode',
        label: 'Режим отдачи по умолчанию',
        defaultValue: 'attachment',
        url: { omitWhenDefault: true },
        hintOf: hintOf('dl_mode'),
        options: [
          { value: 'attachment', label: 'attachment (скачивание с UTF-8 именем)' },
          { value: 'inline', label: 'inline (просмотр / Range-стриминг)' },
        ],
      }),
      demoSelect({
        key: 'dl_rate',
        label: 'Лимит скорости скачивания (rate)',
        defaultValue: 'default',
        url: { omitWhenDefault: true },
        hintOf: hintOf('dl_rate'),
        options: [
          { value: 'default', label: 'По настройке сервера' },
          { value: '262144', label: '256 КБ/с' },
          { value: '65536', label: '64 КБ/с' },
          { value: '0', label: 'rate: 0 (снять лимит)' },
        ],
      }),
      demoSelect({
        key: 'dl_concurrency',
        label: 'Параллельные потоки скачивания (concurrency)',
        defaultValue: 'default',
        url: { omitWhenDefault: true },
        hintOf: hintOf('dl_concurrency'),
        options: [
          { value: 'default', label: 'По настройке сервера' },
          { value: 'reject_1', label: 'max: 1, reject (HTTP 429)' },
          { value: 'queue_1', label: 'max: 1, queue (очередь)' },
          { value: 'preempt_1', label: 'max: 1, preempt (вытеснение)' },
          { value: '0', label: 'concurrency: 0 (снять лимит)' },
        ],
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
