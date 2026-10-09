// Защита из lib/form обязана работать ВСЕГДА, поэтому слои собираются здесь,
// а не по вкусу автора каждого маршрута: приёмник, который забыл `origin`,
// молча принимает межсайтовый POST, и это ровно та дыра, из-за которой
// «защита есть, но её никто не включил».
//
// Список публичных адресов — один на всё приложение: переменная
// KIT_TRUSTED_ORIGINS (через запятую). Wildcard-хост (`https://*.e2b.app`)
// понимает только этот модуль: у SvelteKit сравнение точное
// (`csrf_trusted_origins.includes(origin)`), поэтому в `svelte.config.js`
// уезжают только точные адреса.
import {
  bodyLayer, methodLayer, namesLayer, originLayer, reject,
  type Layer,
} from '$lib/form/server'

/** Точные адреса из окружения (wildcard-записи отфильтрованы ниже). */
function fromEnv(): string[] {
  return (process.env.KIT_TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Локальные адреса и превью песочницы. Прокси превью обращается к
 * `127.0.0.1:PORT` и подменяет `Host`, поэтому публичный адрес обязан быть в
 * списке, иначе любая форма ловит 403 от фреймворка. localhost оставлен
 * сознательно: межсайтовый атакующий приходит со СВОИМ origin, а не с
 * локального адреса, — проверка от этого не ослабевает.
 */
function localOrigins(): string[] {
  const ports = (process.env.PREVIEW_PORTS ?? '5173,5174')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const sandbox = process.env.E2B_SANDBOX_ID
  return ports.flatMap((p) => [
    `http://localhost:${p}`,
    `http://127.0.0.1:${p}`,
    ...(sandbox ? [`https://${p}-${sandbox}.e2b.app`] : []),
  ])
}

const all = [...new Set([...fromEnv(), ...localOrigins()])]
const exact = all.filter((o) => !o.includes('*'))
const patterns = all
  .filter((o) => o.includes('*'))
  .map((o) => new RegExp(`^${o.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+')}$`))

/** Точные адреса для `kit.csrf.trustedOrigins` — того же источника, что и слой. */
export const TRUSTED_ORIGINS: readonly string[] = exact

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

/** Строгий режим библиотеки: неизвестный origin = отказ, пустые заголовки = отказ. */
const strict = originLayer({ allowed: exact, strict: true })

/** Слой 02 приложения: wildcard-исключения поверх библиотечной проверки. */
export const originGuard: Layer = (ctx) => {
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
