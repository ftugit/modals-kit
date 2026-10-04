// Таблица роутов: проверка адреса в РАНТАЙМЕ — чистая логика без среды.
//
// В оригинале таблицу роутов роутеру передавал корень приложения
// (`FastEdgeApp({ routes })`), а `resolves(href)` (внешний адрес → true,
// иначе `matchPath` по дереву) получали все: LoadLink блокировал битую
// ссылку ДО клика, ModalTrigger через ЯДРО спрашивал, существует ли
// страница route-модалки.
//
// Здесь таблицу играет список файлов роутов SvelteKit (glob сворачивает
// его на сборке — это и есть «приложение передаёт фреймворку свои роуты»),
// а сам список приходит параметром: модуль не знает ни про Vite, ни про
// каталоги. Проверка живёт в СЛОЕ ФРЕЙМВОРКА ЯДРА, а не в компонентах —
// решение владельца (осмотр 1.10-2, №30): типизированный `resolve()` из
// `$app/paths` остаётся ДОПОЛНИТЕЛЬНЫМ страховщиком на компиляции, но
// рантайм-проверку он не заменяет: битая ссылка обязана блокироваться
// и в чужом href, и в route-модалке.

/** Путь файла роута → регулярка URL: `/cards/[id]` → `^/cards/([^/]+)$`. */
export function routePattern(file: string): RegExp {
  // `/\/?\+page\.svelte$/` — срезает и `/modals/+page.svelte`, и корневой
  // `+page.svelte` (после снятия префикса слэша у него уже нет)
  const route = file.replace(/^\/src\/routes\//, '').replace(/\/?\+page\.svelte$/, '')
  if (route === '') return /^\/$/
  const parts: string[] = []
  for (const seg of route.split('/')) {
    if (seg.startsWith('(') && seg.endsWith(')')) continue // group — не в адресе
    if (/^\[\.\.\..+\]$/.test(seg)) {
      // [...rest] — ноль и больше сегментов: `/x/[...rest]` → `^/x(?:/(.*))?$`
      return new RegExp(`^${parts.join('')}(?:/(.*))?$`)
    }
    if (/^\[.+\]$/.test(seg)) parts.push('/([^/]+)')
    else parts.push('/' + seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  }
  return new RegExp(`^${parts.join('')}$`)
}

/** `resolves` по заданному списку файлов роутов. */
export function makeRouteResolves(files: string[]): (href: string) => boolean {
  const patterns = files.map(routePattern)
  return (href) => {
    // внешний адрес (scheme://, //, mailto:) — не наш вопрос, как в оригинале
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return true
    const raw = href.split(/[?#]/, 1)[0] || '/'
    const path = raw.length > 1 ? raw.replace(/\/+$/, '') : raw
    return patterns.some((re) => re.test(path))
  }
}
