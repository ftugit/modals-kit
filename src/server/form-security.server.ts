// Защита из lib/form обязана работать ВСЕГДА, поэтому слои собираются здесь,
// а не по вкусу автора каждого маршрута: приёмник, который забыл `origin`,
// молча принимает межсайтовый POST, и это ровно та дыра, из-за которой
// «защита есть, но её никто не включил».
//
// Список доверенных адресов — один на всё приложение (`trusted-origins.ts`): его же
// получает фреймворк через `csrf.trustedOrigins` в `vite.config.ts`. Wildcard-хост
// (`https://*.e2b.app`) понимает только этот слой: у SvelteKit сравнение точное.
//
// Окружение — `$app/env/private` (перечень и проверки — `src/env.ts`), а не
// `process.env`: так переменные приходят на любом адаптере (Workers — из
// `platform.env`) и в dev из `.env`. Списки собираются при ПЕРВОЙ проверке, а не
// при импорте: к запросу SvelteKit окружение уже заполнил.
import { DEV } from 'esm-env'
import { E2B_SANDBOX_ID, KIT_TRUSTED_ORIGINS, PREVIEW_PORTS } from '$app/env/private'
import {
  bodyLayer, methodLayer, namesLayer, originLayer, reject,
  type Layer,
} from '#lib/form/server.js'
import { trustedOrigins } from './trusted-origins'

type Origins = { exact: string[]; patterns: RegExp[]; strict: Layer }
let origins: Origins | null = null

/** Списки адресов и строгий слой — один раз на процесс, при первой проверке. */
function trusted(): Origins {
  if (origins) return origins
  const { exact, patterns } = trustedOrigins(
    (key) => ({ E2B_SANDBOX_ID, KIT_TRUSTED_ORIGINS, PREVIEW_PORTS })[key],
    { dev: DEV },
  )
  /** Строгий режим библиотеки: неизвестный origin = отказ, пустые заголовки = отказ. */
  const strict = originLayer({ allowed: exact, strict: true })
  return (origins = { exact, patterns, strict })
}

function parseCleanOrigin(headerValue: string | null, allowPath = false): string | null {
  if (!headerValue) return null
  const trimmed = headerValue.trim()
  if (!trimmed || trimmed === 'null') return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (parsed.username || parsed.password) return null
    if (!allowPath) {
      const normalized = trimmed.replace(/\/+$/, '').toLowerCase()
      if (normalized !== parsed.origin.toLowerCase()) return null
    }
    return parsed.origin
  } catch {
    return null
  }
}

/** Слой 02 приложения: собственный origin запроса всегда разрешён (как в SvelteKit CSRF), плюс список и wildcard-исключения. */
export const originGuard: Layer = (ctx) => {
  const own = new URL(ctx.request.url).origin
  const rawOrigin = ctx.request.headers.get('origin')
  const rawReferer = ctx.request.headers.get('referer')
  const gotOrigin = rawOrigin
    ? parseCleanOrigin(rawOrigin, false)
    : parseCleanOrigin(rawReferer, true)

  if (gotOrigin === own) return undefined

  const { exact, patterns, strict } = trusted()
  const strictOrigin = parseCleanOrigin(rawOrigin, false)
  if (strictOrigin && patterns.some((re) => re.test(strictOrigin))) return undefined
  if (exact.length > 0) return strict(ctx)
  return reject(403, 'origin.rejected', { own, got: rawOrigin ?? rawReferer })
}

/**
 * Порядок слоёв для всех приёмников: тот же, что по умолчанию в
 * `createFormHandler`, но слой 02 включён всегда. Свой `order` нужен ровно
 * из-за wildcard'ов: `originLayer` сравнивает списком.
 */
export const SECURITY_LAYERS: readonly Layer[] = [
  methodLayer(), originGuard, bodyLayer, namesLayer,
]
