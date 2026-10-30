// Список адресов, которым разрешена межсайтовая отправка форм, — один на приложение.
//
// Его читают два места, и раньше каждое собирало список само (две копии одной логики):
//   • `vite.config.ts` → `csrf.trustedOrigins` — проверка фреймворка; окружение — `process.env`
//     в момент сборки/запуска dev;
//   • `form-security.ts` → слой 02 — проверка библиотеки форм; окружение — `$app/env/private`
//     при первом запросе.
// Поэтому модуль чистый: ни `$app/*`, ни `process` — окружение передаётся функцией.
//
// Источник — переменная `KIT_TRUSTED_ORIGINS` (через запятую) плюс локальные адреса и превью
// песочницы. Wildcard-хост (`https://*.e2b.app`) понимает только слой 02: SvelteKit сравнивает
// точной строкой (`csrf_trusted_origins.includes(origin)`), поэтому фреймворку уходит `exact`.
//
// Зачем не `'*'`: `'*'` выключает проверку фреймворка у ВСЕГО приложения и во всех сборках,
// включая прод. Проверка бесплатна, когда известен публичный адрес, — значит перечисляем адреса.

/** Чтение одной переменной окружения; `undefined` — не задана. */
export type EnvGet = (key: string) => string | undefined

export type TrustedOrigins = {
  /** Точные адреса: их сравнивают и SvelteKit, и строгий слой библиотеки. */
  exact: string[]
  /** Записи с `*`, превращённые в выражения: их понимает только слой 02. */
  patterns: RegExp[]
}

const list = (value: string | undefined): string[] =>
  (value ?? '').split(',').map((s) => s.trim()).filter(Boolean)

/**
 * Локальные адреса и превью песочницы. Прокси превью обращается к `127.0.0.1:PORT` и
 * подменяет `Host`, поэтому публичный адрес обязан быть в списке, иначе любая форма ловит
 * 403 от фреймворка. localhost оставлен сознательно: межсайтовый атакующий приходит со СВОИМ
 * origin, а не с локального адреса, — проверка от этого не ослабевает.
 */
function localOrigins(get: EnvGet): string[] {
  // `||`, а не `??`: пустое значение = «не задано» (контракт `.env.example`), и сборка
  // (`process.env`, где пустая строка остаётся строкой) видит тот же список, что сервер.
  const ports = list(get('PREVIEW_PORTS') || '5173,5174')
  const sandbox = get('E2B_SANDBOX_ID')
  return ports.flatMap((p) => [
    `http://localhost:${p}`,
    `http://127.0.0.1:${p}`,
    ...(sandbox ? [`https://${p}-${sandbox}.e2b.app`] : []),
  ])
}

const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

const WILDCARD_ORIGIN_SHAPE_RE = /^https?:\/\/[a-z0-9*.-]+(?::\d{1,5})?$/i

export type TrustedOriginsOptions = {
  /** Включать ли локальные порты `localhost` / `127.0.0.1` без явных `PREVIEW_PORTS`/`E2B_SANDBOX_ID` (по умолчанию `true` для обратной совместимости в dev/тестах). */
  dev?: boolean
}

function normalizeConfiguredOrigin(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

/** Собирает список из окружения: точные адреса и wildcard-записи раздельно. */
export function trustedOrigins(get: EnvGet, opts?: TrustedOriginsOptions): TrustedOrigins {
  const includeLocal =
    (opts?.dev ?? true) || Boolean(get('E2B_SANDBOX_ID')) || Boolean(get('PREVIEW_PORTS'))
  const configured = list(get('KIT_TRUSTED_ORIGINS')).map(normalizeConfiguredOrigin).filter(Boolean)
  const all = [...new Set([...configured, ...(includeLocal ? localOrigins(get) : [])])]
  return {
    exact: all.filter((o) => !o.includes('*')),
    patterns: all
      .filter((o) => o.includes('*') && WILDCARD_ORIGIN_SHAPE_RE.test(o))
      .map((o) => new RegExp(`^${escape(o).replace(/\*/g, '[a-z0-9-]+')}$`, 'i')),
  }
}

/**
 * Пришёл ли запрос от страницы этого же сайта — по заголовку `Sec-Fetch-Site`
 * (Fetch Metadata; во всех браузерах с марта 2023: Chrome 76, Firefox 90, Safari 16.4).
 * Пропускает только `same-origin`: чужой сайт (`cross-site`), соседний поддомен
 * (`same-site`) и адрес, открытый руками (`none`), получают отказ.
 *
 * Это не защита от парсеров: заголовок ставит браузер, а скрипт подделывает его одной
 * строкой. Отсекает чужие страницы в браузере и простые скачивания без заголовка.
 *
 * Браузер шлёт заголовок только на «доверенные» адреса (https, localhost/127.0.0.1).
 * Dev по http с адреса сети заголовка не получит, поэтому `allowMissing` — для dev.
 * @param request Входящий запрос.
 * @param allowMissing Пропускать запрос без заголовка (dev по http).
 * @returns `true` — запрос со страницы этого сайта.
 */
export function sameOriginFetch(request: Request, allowMissing = false): boolean {
  const site = request.headers.get('sec-fetch-site')
  return site === 'same-origin' || (site === null && allowMissing)
}

const INLINE_SCRIPT_RE = /<script\b[^>]*>([\s\S]*?)<\/script>/gi

/**
 * Вычислить `sha256-...` (без кавычек — их добавляет сам SvelteKit `Csp`) для всех
 * инлайновых `<script>` в `src/app.html`, не содержащих `src=`.
 * Хеши работают одинаково и на SSR (рядом с `nonce`), и на пререндере (где `%sveltekit.nonce%` недоступен).
 */
export function appHtmlScriptHashes(
  html: string,
  sha256Base64: (content: string) => string,
): `sha256-${string}`[] {
  const hashes: `sha256-${string}`[] = []
  for (const match of html.matchAll(INLINE_SCRIPT_RE)) {
    const openTag = match[0].slice(0, match[0].indexOf('>') + 1)
    if (/\bsrc\s*=/i.test(openTag)) continue
    const body = match[1] ?? ''
    if (!body) continue
    hashes.push(`sha256-${sha256Base64(body)}`)
  }
  return hashes
}

export type CspOptions = {
  get: EnvGet
  dev: boolean
  inlineScriptHashes?: readonly `sha256-${string}`[]
}

/**
 * Строгие директивы `kit.csp` (без внешних шрифтов и чужих скриптов):
 * - токены передаются БЕЗ кавычек (`'self'`, `sha256-...` оборачивает в `'...'` сам SvelteKit);
 * - `'wasm-unsafe-eval'` разрешает WebAssembly-кодеки изображений (`#lib/image` / `@jsquash/*`);
 * - `style-src-elem: ['self']` запирает `<style>` и `<link rel="stylesheet">` в проде
 *   (в `dev` сам SvelteKit подмешивает `'unsafe-inline'` для HMR), а `style-src-attr`
 *   допускает реактивные `style:...` атрибуты компонентов;
 * - `'frame-ancestors': ['none']` включается в чистом проде, но опускается в `dev`,
 *   в песочнице превью (`E2B_SANDBOX_ID`) и при явном iframe-режиме кук (`AUTH_COOKIE_SAMESITE=none`).
 */
export function cspDirectives(opts: CspOptions) {
  const isPreviewEnv =
    opts.dev ||
    Boolean(opts.get('E2B_SANDBOX_ID')) ||
    opts.get('AUTH_COOKIE_SAMESITE') === 'none'
  const scriptHashes = opts.inlineScriptHashes ?? []

  return {
    'default-src': ['self' as const],
    'script-src': ['self' as const, 'wasm-unsafe-eval' as const, ...scriptHashes],
    'style-src': ['self' as const, 'unsafe-inline' as const],
    'style-src-elem': ['self' as const],
    'style-src-attr': ['unsafe-inline' as const],
    'font-src': ['self' as const, 'data:' as const],
    'img-src': ['self' as const, 'data:' as const, 'blob:' as const, 'https:' as const],
    'media-src': ['self' as const, 'blob:' as const],
    'connect-src': opts.dev
      ? ['self' as const, 'ws:' as const, 'wss:' as const]
      : ['self' as const],
    'worker-src': ['self' as const, 'blob:' as const],
    'frame-src': ['self' as const],
    'object-src': ['none' as const],
    'base-uri': ['self' as const],
    'form-action': ['self' as const],
    ...(isPreviewEnv ? {} : { 'frame-ancestors': ['none' as const] }),
  }
}
