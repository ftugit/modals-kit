// Переменные окружения приложения — единственный перечень (docs: «Environment variables»).
// Значения читаются из `$app/env/private`; `process.env` код напрямую не трогает.
// Шаблон с подробными пояснениями и значениями по умолчанию — `.env.example`.
//
// Все переменные необязательны, и контракт `.env.example` — «пустое значение = не задано».
// Без `schema` SvelteKit требует непустую строку, поэтому у каждой переменной есть проверка,
// которая сводит `''` к `undefined`. Проверки синхронные и реализуют Standard Schema напрямую:
// библиотека схем ради двенадцати строк не нужна, а тип `@standard-schema/spec` уже в зависимостях.
// Ошибка проверки останавливает старт и называет переменную — лучше, чем `NaN` в пуле соединений.
import { defineEnvVars } from '@sveltejs/kit/env'
import type { StandardSchemaV1 } from '@standard-schema/spec'

type Check<T> = (value: string) => { value: T } | { message: string }

/** Standard Schema из функции; `''` и отсутствие значения → `undefined` без вызова проверки. */
function optional<T>(check: Check<T>): StandardSchemaV1<string | undefined, T | undefined> {
  return {
    '~standard': {
      version: 1,
      vendor: 'modals-kit',
      validate(input) {
        if (input === undefined || input === '') return { value: undefined }
        if (typeof input !== 'string') return { issues: [{ message: 'ожидалась строка' }] }
        const result = check(input)
        return 'message' in result ? { issues: [{ message: result.message }] } : result
      },
    },
  }
}

const text = optional((value) => ({ value }))

/** Флаг: `1`/`true`/`yes` (любой регистр) → `true`; всё прочее — ошибка запуска с именем переменной. */
const flag = optional((value) =>
  ['1', 'true', 'yes'].includes(value.toLowerCase())
    ? { value: true }
    : { message: `ожидался флаг 1/true/yes, задано символов: ${value.length}` },
)

/** Секрет, который подбирают перебором: короче 32 символов — отказ запуска. */
const secret = optional((value) =>
  value.length >= 32 ? { value } : { message: `нужно не короче 32 символов, задано ${value.length}` },
)

const SEAL_KEY_ID_RE = /^[A-Za-z0-9_]{1,32}$/
const CURSOR_KEY_ID_RE = /^[A-Za-z0-9_-]{1,32}$/

const idSchema = (pattern: RegExp, format: string) => optional((value) =>
  pattern.test(value)
    ? { value }
    : { message: `ожидался идентификатор ${format} (1..32), задано символов: ${value.length}` },
)
const sealKeyId = idSchema(SEAL_KEY_ID_RE, 'из латиницы, цифр и «_»')
const cursorKeyId = idSchema(CURSOR_KEY_ID_RE, 'из латиницы, цифр, «_» и «-»')

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** Ключ seed-модели: каноничный base64url без паддинга, ровно 32 байта (43 символа, младшие 2 бита 43-го символа = 0). */
const seedKey = optional((value) => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    return {
      message: `ожидался каноничный ключ base64url из 43 символов (32 байта без «=»), задано символов: ${value.length}`,
    }
  }
  const lastIdx = BASE64URL_ALPHABET.indexOf(value[42]!)
  if (lastIdx < 0 || (lastIdx & 0b11) !== 0) {
    return {
      message:
        'ожидался каноничный ключ base64url из 43 символов (32 байта): ненулевые хвостовые биты в 43-м символе',
    }
  }
  return { value }
})

/** Ротация: секрет не короче 32 символов, имена не повторяются. */
const rotationList = (pattern: RegExp, format: string) => optional((value) => {
  const seen = new Set<string>()
  for (const rawPair of value.split(',')) {
    const pair = rawPair.trim()
    if (!pair) continue
    const sep = pair.indexOf(':')
    if (sep <= 0) return { message: 'ожидался формат id:secret через запятую' }
    const id = pair.slice(0, sep).trim()
    const keyVal = pair.slice(sep + 1).trim()
    if (!pattern.test(id)) return { message: `недопустимое имя ключа: ${format} (1..32), задано символов: ${id.length}` }
    if (seen.has(id)) return { message: `имя старого ключа повторяется (длина ${id.length})` }
    seen.add(id)
    if (keyVal.length < 32) return { message: `секрет старого ключа короче 32 символов (задано ${keyVal.length})` }
  }
  return { value }
})
const sealKeyRotationList = rotationList(SEAL_KEY_ID_RE, 'латиница, цифры, «_»')
const cursorKeyRotationList = rotationList(CURSOR_KEY_ID_RE, 'латиница, цифры, «_», «-»')

const positiveInteger = optional((value) => {
  const n = Number(value)
  return /^\d+$/.test(value) && Number.isSafeInteger(n) && n >= 1
    ? { value: n }
    : { message: `ожидалось целое число ≥ 1, получено «${value}»` }
})

// Node timers accept delays up to 2^31−1 milliseconds. Reject impractical
// values instead of silently overflowing or changing the requested policy.
const wsTimerSeconds = optional((value) => {
  const n = Number(value)
  return /^\d+$/.test(value) && Number.isSafeInteger(n) && n >= 1 && n <= 2_147_483
    ? { value: n }
    : { message: 'ожидалось целое число секунд от 1 до 2147483' }
})

const wsPauseSeconds = optional((value) => {
  const n = Number(value)
  return /^\d+$/.test(value) && Number.isSafeInteger(n) && n >= 0 && n <= 2_147_483
    ? { value: n }
    : { message: 'ожидалось целое число секунд от 0 до 2147483' }
})

const MIN_WS_CHUNK_BYTES = 64 * 1024
const MAX_WS_CHUNK_BYTES = 16 * 1024 * 1024

/** Размер сегмента `wss://`-загрузки: число байт или суффикс `kb`/`mb` (`64 КБ` .. `16 МБ`). */
const wsChunkBytes = optional((value) => {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|kib|mb|mib)?\s*$/i.exec(value)
  if (!m) {
    return {
      message: `ожидалось число байт или размер с суффиксом kb/mb (например 512kb или 1mb), получено «${value}»`,
    }
  }
  const num = Number(m[1])
  const unit = (m[2] ?? 'b').toLowerCase()
  const mult =
    unit === 'kb' || unit === 'kib'
      ? 1024
      : unit === 'mb' || unit === 'mib'
        ? 1024 * 1024
        : 1
  const bytes = Math.round(num * mult)
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < MIN_WS_CHUNK_BYTES ||
    bytes > MAX_WS_CHUNK_BYTES
  ) {
    return {
      message: `допустимый диапазон сегмента 64kb..16mb (${MIN_WS_CHUNK_BYTES}..${MAX_WS_CHUNK_BYTES} байт), получено «${value}»`,
    }
  }
  return { value: bytes }
})

export const variables = defineEnvVars({
  // ── Адрес приложения и доверие origin (`src/server/trusted-origins.ts`) ──
  KIT_TRUSTED_ORIGINS: {
    schema: text,
    description:
      'Публичные адреса через запятую (СХЕМА://ХОСТ[:ПОРТ]). Читается и при сборке — для csrf.trustedOrigins в vite.config.ts.',
  },
  PREVIEW_PORTS: {
    schema: text,
    description: 'Локальные порты, которым доверяется origin (localhost и 127.0.0.1). По умолчанию 5173,5174.',
  },
  E2B_SANDBOX_ID: {
    schema: text,
    description: 'Задаёт песочница превью: к PREVIEW_PORTS добавляется https://PORT-ID.e2b.app.',
  },

  // ── Тело форм (`src/server/form-budget.server.ts`) и потоковый `wss://`-транспорт ──
  FORM_BODY_LIMIT: {
    schema: positiveInteger,
    description:
      'Потолок тела формы, байт: столько пропускает развёртывание (Vercel — до 4.5 МБ, Cloudflare — 100 МБ). ' +
      'Форма может объявить меньше; больше — молча игнорируется. По умолчанию 2 МиБ (DEFAULT_LIMITS.maxBytes).',
  },
  WS_UPLOAD_CHUNK_SIZE: {
    schema: wsChunkBytes,
    description:
      'Размер одного файлового сегмента потоковой `wss://`-загрузки (байты или суффиксы `kb`/`mb`, диапазон `64kb`..`16mb`). ' +
      'По умолчанию 256 КБ; на Vercel и Cloudflare допустимо поднимать до 1mb–8mb (лимит кадра Cloudflare — 32 МиБ, а maxPayload в ws поднимается автоматически).',
  },
  WS_UPLOAD_TTL_SECONDS: {
    schema: wsTimerSeconds,
    description: 'Максимальная длительность одной WS-загрузки с момента открытия, секунды; по умолчанию 300.',
  },
  WS_UPLOAD_IDLE_SECONDS: {
    schema: wsTimerSeconds,
    description: 'Базовое ожидание init/resume и данных, секунды; по умолчанию 10. Для целого сегмента добавляется время по его размеру.',
  },
  WS_UPLOAD_PAUSE_MAX_SECONDS: {
    schema: wsPauseSeconds,
    description: 'Максимальная пауза WS-загрузки в секундах; по умолчанию 60, 0 отключает паузы.',
  },
  WS_UPLOAD_RATE_BUDGET_BYTES_PER_SECOND: {
    schema: positiveInteger,
    description: 'Расчётная скорость для надбавки к ожиданию целого WS-сегмента, байт/с; по умолчанию 32768.',
  },
  WS_UPLOAD_MAX_DURATION: {
    schema: positiveInteger,
    description:
      'Явный лимит времени жизни одного `wss://`-соединения платформы в секундах для прогноза успеваемости выгрузки ' +
      '(например 300 на Vercel Hobby или 800 на Vercel Pro). Пусто — автоопределение по платформе (Vercel = 300 с, Node/Cloudflare = без потолка).',
  },

  // ── Движок данных (`open()` в `src/server/db.server.ts`) ──
  HYPERDRIVE_CONNECTION_STRING: {
    schema: text,
    description: 'Строка Cloudflare Hyperdrive. Перекрывает DATABASE_URL.',
  },
  DATABASE_URL: {
    schema: text,
    description: 'Внешний Postgres: postgres://user:pass@host:5432/db.',
  },
  DATABASE_DIR: {
    schema: text,
    description: 'Каталог файловых данных PGlite. Без него PGlite работает в памяти.',
  },
  DATABASE_RESET: {
    schema: flag,
    description:
      'Сброс при каждой СБОРКЕ: поддерживаемые объекты public и их данные в выделенной DATABASE_URL удаляются транзакционно, ' +
      'сама схема и её права сохраняются. При первом обращении рантайм создаст модели и администратора. ' +
      'ВНИМАНИЕ: данные таблиц уничтожаются до переключения деплоя; Preview и Production должны использовать разные базы.',
  },
  DB_POOL_MAX: {
    schema: positiveInteger,
    description: 'Соединений в пуле (ветка DATABASE_URL). По умолчанию 1 на Vercel, иначе 4.',
  },
  DB_CONNECT_TIMEOUT_MS: {
    schema: positiveInteger,
    description: 'Таймаут установки соединения, мс. По умолчанию 30000.',
  },
  VERCEL: {
    schema: text,
    description: 'Задаёт платформа Vercel; влияет на значение DB_POOL_MAX по умолчанию.',
  },
  DB_ADMIN_TOKEN: {
    schema: secret,
    description:
      'Секрет кнопки «Выполнить» на экране переноса схемы (/schema), не короче 32 символов. Без него перенос по кнопке выключен.',
  },

  // ── Указатель следующего шага (`?page.after`) ──
  DB_CURSOR_SECRET: {
    schema: secret,
    description: 'Секрет подписи курсора, не короче 32 байт. Без него курсорный режим выключен.',
  },
  DB_CURSOR_TTL_SECONDS: {
    schema: positiveInteger,
    description: 'Время жизни токена курсора, секунд. По умолчанию 1800.',
  },
  DB_CURSOR_MAX_AGE_SECONDS: {
    schema: positiveInteger,
    description:
      'Потолок возраста указателя, секунд: просроченный токен принимается, пока не старше этого срока. По умолчанию 604800 (7 дней); меньше DB_CURSOR_TTL_SECONDS — ошибка запуска.',
  },
  DB_CURSOR_KID: {
    schema: cursorKeyId,
    description: 'Имя действующего секрета курсора (пишется в токен). По умолчанию v1; при смене секрета — новое имя.',
  },
  DB_CURSOR_OLD_KEYS: {
    schema: cursorKeyRotationList,
    description: 'Прежние секреты на время ротации: kid:secret через запятую (kid ≠ DB_CURSOR_KID).',
  },

  // ── Запечатывание токенов пользователя (модуль `src/content/user`) ──
  AUTH_SEAL_SECRET: {
    schema: secret,
    description: 'Секрет запечатывания временного токена и токена продления (iron), не короче 32 байт.',
  },
  AUTH_SEAL_ID: {
    schema: sealKeyId,
    description: 'Имя действующего секрета (печатается в токен). По умолчанию v1; при смене секрета — новое имя.',
  },
  AUTH_SEAL_OLD_KEYS: {
    schema: sealKeyRotationList,
    description: 'Прежние секреты на время ротации: id:secret через запятую (id ≠ AUTH_SEAL_ID).',
  },
  AUTH_COOKIE_SAMESITE: {
    schema: text,
    description:
      'SameSite сессионных кук: пусто — lax (обычный сайт, куки не едут в чужие контексты); ' +
      '`none` — вход должен жить внутри чужого iframe (превью песочницы): куки ставятся с Secure и Partitioned ' +
      '(CHIPS — иначе браузеры, режущие сторонние куки, их не сохранят). ' +
      'Это ослабление защиты (куки в сторонних контекстах) — только для демо/превью, не для продакшена.',
  },
  ADMIN_SEED: {
    schema: seedKey,
    description:
      'Приватный ключ первого администратора — то же значение, что вставляется в поле «Seed» формы входа ' +
      '(публичный seed сервер выводит сам и кладёт в БД). Задаёт постоянный вход при перезапусках и на ' +
      'пустой базе в памяти; не задан — связка генерируется и один раз печатается в лог. ' +
      'Уже существующего администратора не заменяет.',
  },
})
