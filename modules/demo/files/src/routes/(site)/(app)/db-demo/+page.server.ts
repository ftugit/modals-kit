/**
 * Демо `lib/db`: список — пагинатор (SSR-снапшот + `/api/db-posts`), формы —
 * отдельные компоненты, приём — регистрации `./db.form.server.ts`
 * (`#hooks/component-form`).
 *
 * У маршрута больше нет `actions`: метод, origin, лимит тела, имена и
 * lock-revision проверяет общий приёмник встраиваемых форм, а маршрут обязан
 * оставаться тонким (свой разбор тела запроса здесь роняет сборку).
 *
 * Адрес списка читает пагинатор (`?db`, `?db.size`, `?db.flt`, `?db.ord`):
 * лоадер больше не режет массив и не парсит `?limit` сам — второго источника
 * правды о показанной странице нет.
 */
import { error, redirect } from '@sveltejs/kit'
import { toKitError } from '#lib/db/sveltekit/index.js'
import { loadDbListSnapshot } from '#content/demo-catalog/posts/list.server.js'
import { isSchemaPending, schemaHref } from '#hooks/schema-route.js'
import { schemaScreen } from '#hooks/db-schema.server.js'
import type { PageServerLoad } from './$types'

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
    // Результат нативного POST — данными СТРАНИЦЫ: её load перезапускается на
    // клиентском переходе, поэтому уведомление гаснет само.
    if (!pending) return { snapshot, formResult: event.locals.formResult ?? null }
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
