// `page.state` текущей записи истории — для браузерных тестов, которые смотрят
// на историю СНАРУЖИ (Playwright), где `$app/state` недоступен.
//
// SvelteKit 3 кладёт состояние shallow-записи в `history.state['sveltekit:metadata'].state`
// строкой транспорта (devalue; своих `transport`-хуков у приложения нет). Это
// внутренний формат роутера, поэтому он прочитан ровно здесь: при смене формата
// правится один файл. `devalue` берётся из зависимостей самого `@sveltejs/kit` —
// та же версия, что пишет строку, без отдельной зависимости проекта.
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kitPackage = fileURLToPath(new URL('../../node_modules/@sveltejs/kit/package.json', import.meta.url))
const { parse } = await import(pathToFileURL(createRequire(kitPackage).resolve('devalue')).href)

/** `page.state` текущей записи (`{}`, если записи SvelteKit нет). */
export async function pageState(page) {
  const raw = await page.evaluate(() => history.state?.['sveltekit:metadata']?.state ?? null)
  return raw ? parse(raw) : {}
}

/** Ждёт, пока `pred(page.state)` станет истинным. */
export async function waitPageState(page, pred, { timeout = 6000, interval = 50 } = {}) {
  const until = Date.now() + timeout
  for (;;) {
    const state = await pageState(page)
    if (pred(state)) return state
    if (Date.now() > until) throw new Error(`waitPageState: тайм-аут ${timeout} мс, page.state = ${JSON.stringify(state)}`)
    await new Promise((r) => setTimeout(r, interval))
  }
}
