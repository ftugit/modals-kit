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
    : { message: `ожидался флаг 1/true/yes, получено «${value}»` },
)

/** Секрет, который подбирают перебором: короче 32 символов — отказ запуска. */
const secret = optional((value) =>
  value.length >= 32 ? { value } : { message: `нужно не короче 32 символов, задано ${value.length}` },
)

const positiveInteger = optional((value) => {
  const n = Number(value)
  return /^\d+$/.test(value) && Number.isSafeInteger(n) && n >= 1
    ? { value: n }
    : { message: `ожидалось целое число ≥ 1, получено «${value}»` }
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
      'Очистка базы из DATABASE_URL при СБОРКЕ (tooling/db-reset.mjs в конце npm run build): схема public сносится ' +
      'целиком один раз на деплой, и тут же разворачиваются все модели, сиды и первый администратор с выводом в Build Logs. ' +
      'В рантайме флаг не читается. ВНИМАНИЕ: уничтожает все данные указанной базы.',
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
    schema: text,
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
    schema: text,
    description: 'Имя действующего секрета курсора (пишется в токен). По умолчанию v1; при смене секрета — новое имя.',
  },
  DB_CURSOR_OLD_KEYS: {
    schema: text,
    description: 'Прежние секреты на время ротации: kid:secret через запятую (kid ≠ DB_CURSOR_KID).',
  },

  // ── Запечатывание токенов пользователя (модуль `src/content/user`) ──
  AUTH_SEAL_SECRET: {
    schema: text,
    description: 'Секрет запечатывания временного токена и токена продления (iron), не короче 32 байт.',
  },
  AUTH_SEAL_ID: {
    schema: text,
    description: 'Имя действующего секрета (печатается в токен). По умолчанию v1; при смене секрета — новое имя.',
  },
  AUTH_SEAL_OLD_KEYS: {
    schema: text,
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
})
