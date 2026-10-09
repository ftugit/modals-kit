/**
 * Демо `lib/db`: список — пагинатор (SSR-снапшот + `/api/db-posts`), формы —
 * отдельные компоненты, приём — конвейер `$lib/ui/demo/db-form/handle`.
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
import { error, fail } from '@sveltejs/kit'
import { toKitError } from '$lib/db/sveltekit'
import { loadDbListSnapshot } from '$lib/server/db-list'
import type { Handled } from '$lib/form/server'
import { failureHandled, handleDbCreate, handleDbRemove } from '$lib/ui/demo/db-form/handle'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async (event) => {
  // Разбор — ВНУТРИ try: отказ слоя (неизвестный ключ, битый JSON фильтра) обязан
  // пройти через toKitError, а не упасть в Kit как сырой DbFailure.
  try {
    const { name, snapshot } = await loadDbListSnapshot(event.url.href)
    return { listName: name, snapshot }
  } catch (e) {
    const kit = toKitError(e, import.meta.env.DEV)
    throw error(kit.status, kit.body)
  }
}

/**
 * Экшены выбирают только кодировку ответа — как в `src/routes/form`: у демо БД
 * и у демо форм один путь приёма.
 */
async function act(intent: 'create' | 'remove', promise: Promise<Handled>) {
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
}
