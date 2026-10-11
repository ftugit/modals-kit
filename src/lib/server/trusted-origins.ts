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

/** Собирает список из окружения: точные адреса и wildcard-записи раздельно. */
export function trustedOrigins(get: EnvGet): TrustedOrigins {
  const all = [...new Set([...list(get('KIT_TRUSTED_ORIGINS')), ...localOrigins(get)])]
  return {
    exact: all.filter((o) => !o.includes('*')),
    patterns: all
      .filter((o) => o.includes('*'))
      .map((o) => new RegExp(`^${escape(o).replace(/\*/g, '[^/]+')}$`)),
  }
}
