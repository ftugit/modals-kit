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
import { E2B_SANDBOX_ID, KIT_TRUSTED_ORIGINS, PREVIEW_PORTS } from '$app/env/private'
import {
  bodyLayer, methodLayer, namesLayer, originLayer, reject,
  type Layer,
} from '$lib/form/server'
import { trustedOrigins } from './trusted-origins'

type Origins = { exact: string[]; patterns: RegExp[]; strict: Layer }
let origins: Origins | null = null

/** Списки адресов и строгий слой — один раз на процесс, при первой проверке. */
function trusted(): Origins {
  if (origins) return origins
  const { exact, patterns } = trustedOrigins(
    (key) => ({ E2B_SANDBOX_ID, KIT_TRUSTED_ORIGINS, PREVIEW_PORTS })[key],
  )
  /** Строгий режим библиотеки: неизвестный origin = отказ, пустые заголовки = отказ. */
  const strict = originLayer({ allowed: exact, strict: true })
  return (origins = { exact, patterns, strict })
}

/** Ничего не настроено: сравниваем с собственным адресом запроса, как фреймворк. */
const sameOrigin: Layer = (ctx) => {
  const own = new URL(ctx.request.url).origin
  const header = ctx.request.headers.get('origin') ?? ctx.request.headers.get('referer')
  let got: string | null = null
  if (header) {
    try { got = new URL(header).origin } catch { got = header }
  }
  return got === own ? undefined : reject(403, 'origin.rejected', { own, got })
}

/** Слой 02 приложения: wildcard-исключения поверх библиотечной проверки. */
export const originGuard: Layer = (ctx) => {
  const { exact, patterns, strict } = trusted()
  const origin = ctx.request.headers.get('origin')
  if (origin && patterns.some((re) => re.test(origin))) return undefined
  return exact.length ? strict(ctx) : sameOrigin(ctx)
}

/**
 * Порядок слоёв для всех приёмников: тот же, что по умолчанию в
 * `createFormHandler`, но слой 02 включён всегда. Свой `order` нужен ровно
 * из-за wildcard'ов: `originLayer` сравнивает списком.
 */
export const SECURITY_LAYERS: readonly Layer[] = [
  methodLayer(), originGuard, bodyLayer, namesLayer,
]
