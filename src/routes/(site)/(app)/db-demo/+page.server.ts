/**
 * Демо `lib/db`: список — пагинатор (SSR-снапшот + `/api/db-posts`), формы —
 * отдельные компоненты, приём — конвейер `./handle.server.ts`.
 *
 * Маршрут тонкий и НЕ трогает `request.formData()`: `?/create` и `?/remove` —
 * form-экшены (нативный POST), поэтому метод и origin проверяет связка
 * `createFormHandler` (она же держит лимит тела, лимит имён и lock-revision).
 * Проверка origin включена и в dev (`verifyOriginInDev`), так что `?/create` с
 * чужого origin даёт ровно тот же 403, что и на проде.
 *
 * Адрес списка читает пагинатор (`?db`, `?db.size`, `?db.flt`, `?db.ord`):
 * лоадер больше не режет массив и не парсит `?limit` сам — второго источника
 * правды о показанной странице нет.
 */
import { error, fail, redirect } from '@sveltejs/kit'
import { toKitError } from '#lib/db/sveltekit/index.js'
import { loadDbListSnapshot } from '#content/demo-catalog/posts/list.server.js'
import type { Handled } from '#lib/form/server.js'
import { isSchemaPending, schemaHref } from '#hooks/schema-route.js'
import { schemaScreen } from '#hooks/db-schema.server.js'
import { failureHandled, handleDbCreate, handleDbRemove, handleDbRename } from './handle.server'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async (event) => {
  // Расхождение схемы — не ошибка страницы, а экран решений на своём адресе
  // (`/schema`): он нужен всем страницам с БД, а не только этой. Пока решений
  // нет, любой запрос к базе отвечает `schema_pending`, поэтому уводим туда же,
  // откуда пришли (`?next=`), а не показываем «ошибка загрузки».
  let pending = false
  try {
    // `name` лоадеру не нужен: страница его не выбирает — имя знает компонент
    // списка, а registration обязана жить и в клиентском бандле.
    const { snapshot } = await loadDbListSnapshot(event.url.href)
    // Отказ списка ловит пагинатор (в снимке — `status: 'error'`). Только тогда
    // спрашиваем схему: исправная страница лишнего запроса не платит.
    if (snapshot.status === 'error') pending = Boolean(await schemaScreen().catch(() => null))
    if (!pending) return { snapshot }
  } catch (e) {
    // Разбор — ВНУТРИ try: отказ слоя (неизвестный ключ, битый JSON фильтра) обязан
    // пройти через toKitError, а не упасть в Kit как сырой DbFailure.
    const kit = toKitError(e, import.meta.env.DEV)
    if (!isSchemaPending(kit.body.code)) throw error(kit.status, kit.body)
    pending = true
  }
  // `redirect` — ВНЕ try: он бросает, и `catch` выше принял бы его за сбой.
  redirect(303, schemaHref(event.url.pathname + event.url.search))
}

/**
 * Экшены выбирают только кодировку ответа — как в `src/routes/(site)/(app)/form`: у демо БД
 * и у демо форм один путь приёма.
 */
async function act(intent: 'create' | 'remove' | 'rename' | 'schema', promise: Promise<Handled>) {
  try {
    const { result, status } = await promise
    // `intent` — чтобы страница подсадила результат ТОЙ форме, которая его
    // вернула: на странице две связанные формы, а `form` у SvelteKit один.
    return result.ok ? { result, intent } : fail(status, { result, intent })
  } catch (e) {
    // Сюда доходит только совсем нежданный сбой: конвейер свои ошибки
    // превращает в Result сам.
    const handled = failureHandled(e)
    return fail(handled.status, { result: handled.result, intent })
  }
}

export const actions: Actions = {
  create: (event) => act('create', handleDbCreate(event.request, 'action', event.locals.dbCtx)),
  remove: (event) => act('remove', handleDbRemove(event.request, 'action', event.locals.dbCtx)),
  rename: (event) => act('rename', handleDbRename(event.request, 'action', event.locals.dbCtx)),
}
