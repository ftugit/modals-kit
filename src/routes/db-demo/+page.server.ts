import { error, fail } from '@sveltejs/kit'
import { parseListInput, toKitError } from '$lib/db/sveltekit'
import { getRuntime, posts } from '$lib/server/db'
import type { Handled } from '$lib/form/server'
import { failureHandled, handleDbCreate, handleDbRemove } from '$lib/ui/demo/db-form/handle'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async (event) => {
  const { db } = await getRuntime()
  const api = db.resource(posts)
  // Разбор — ВНУТРИ try: отказ (неизвестный ключ, битый JSON) обязан пройти
  // через toKitError, а не упасть в Kit как сырой DbFailure.
  try {
    const input = parseListInput(event.url.searchParams)
    const [items, totalItems] = await Promise.all([
      api.select(event.locals.dbCtx, input),
      api.count(event.locals.dbCtx, {})
    ])
    return { items, totalItems, pageSize: input.limit ?? 20 }
  } catch (e) {
    const kit = toKitError(e, import.meta.env.DEV)
    throw error(kit.status, kit.body)
  }
}

/**
 * Мутации собраны на слоях lib/form (см. `$lib/ui/demo/db-form/handle`): тело
 * читает `bodyLayer`, имена сверяет `namesLayer`, origin проверяет слой 02 из
 * `form-security`. Экшену остаётся выбрать кодировку — как это делает
 * `src/routes/form/+page.server.ts`, чтобы у демо БД и у демо форм был один путь.
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
